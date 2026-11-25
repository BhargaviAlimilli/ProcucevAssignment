import { useEffect, useRef, useState } from 'react';
import {
  PCM_WORKLET_CODE,
  appendSmartText,
  calculateLevelPercent,
  computeSpectrumBars,
  detectScriptBadge,
  downsampleTo16kPcm,
  formatDuration,
} from '../utils/audio.js';

const LANGUAGE_MODES = [
  { short: 'AUTO', label: 'Auto (Multilingual)', value: 'Auto (Multilingual)', codes: [] },
  { short: 'HI + EN', label: 'Hindi + English', value: 'Hindi + English (hi-IN, en-IN)', codes: ['hi-IN', 'en-IN'] },
  { short: 'हिंदी', label: 'Hindi (hi-IN)', value: 'Hindi (hi-IN)', codes: ['hi-IN'] },
  { short: 'EN-IN', label: 'English (IN)', value: 'English India (en-IN)', codes: ['en-IN'] },
  { short: 'EN-US', label: 'English (US)', value: 'English US (en-US)', codes: ['en-US'] },
];

const BAR_COUNT = 24;

export default function LiveStudio({ onSaved, onNotify }) {
  const [title, setTitle] = useState('');
  const [languageMode, setLanguageMode] = useState('Auto (Multilingual)');
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [spectrumBars, setSpectrumBars] = useState(() => new Array(BAR_COUNT).fill(6));
  const [wsStatus, setWsStatus] = useState({ text: 'STANDBY', tone: 'neutral' });

  const [committedText, setCommittedText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const committedRef = useRef('');
  const interimRef = useRef('');
  const isRecordingRef = useRef(false);
  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const workletNodeRef = useRef(null);
  const scriptNodeRef = useRef(null);
  const timerRef = useRef(null);
  const displayBoxRef = useRef(null);

  useEffect(() => {
    if (displayBoxRef.current) {
      displayBoxRef.current.scrollTop = displayBoxRef.current.scrollHeight;
    }
  }, [committedText, interimText]);

  useEffect(() => {
    return () => {
      cleanupAudioAndSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function syncTextState(nextCommitted, nextInterim) {
    committedRef.current = nextCommitted;
    interimRef.current = nextInterim;
    setCommittedText(nextCommitted);
    setInterimText(nextInterim);
  }

  function startSpectrumLoop() {
    const tick = () => {
      if (!isRecordingRef.current) return;
      setSpectrumBars(computeSpectrumBars(analyserRef.current, BAR_COUNT));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function cleanupAudioAndSocket({ skipWsClose = false } = {}) {
    isRecordingRef.current = false;
    setIsRecording(false);

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (interimRef.current) {
      const merged = appendSmartText(committedRef.current, interimRef.current);
      syncTextState(merged, '');
    }

    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (scriptNodeRef.current) {
      scriptNodeRef.current.disconnect();
      scriptNodeRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (!skipWsClose && wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
        wsRef.current.close();
      }
      wsRef.current = null;
    }

    setMicLevel(0);
    setSpectrumBars(new Array(BAR_COUNT).fill(6));
    setWsStatus({ text: 'STANDBY', tone: 'neutral' });
  }

  async function startRecording() {
    if (isRecordingRef.current) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      onNotify('Microphone capture is not supported in this browser.', 'error');
      return;
    }

    if (isEditing) {
      syncTextState(editDraft, '');
      setIsEditing(false);
    }

    try {
      setWsStatus({ text: 'LINKING...', tone: 'connecting' });

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const selectedConfig =
        LANGUAGE_MODES.find((m) => m.value === languageMode) || LANGUAGE_MODES[0];

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/transcribe`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'start',
            languageCodes: selectedConfig.codes,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'status') {
            if (msg.status === 'ready') {
              setWsStatus({ text: `ON AIR · ${msg.model}`, tone: 'live' });
            } else if (msg.status === 'connecting') {
              setWsStatus({ text: 'SYNCING MODEL...', tone: 'connecting' });
            } else if (msg.status === 'stopped' || msg.status === 'closed') {
              if (!isRecordingRef.current) {
                setWsStatus({ text: 'STANDBY', tone: 'neutral' });
              }
            }
          } else if (msg.type === 'transcript') {
            const chunk = msg.text || '';
            if (msg.isFinal) {
              let nextCommitted = committedRef.current;
              if (chunk) {
                if (interimRef.current && chunk.startsWith(interimRef.current)) {
                  nextCommitted = appendSmartText(nextCommitted, chunk);
                } else {
                  const combined = appendSmartText(interimRef.current, chunk);
                  nextCommitted = appendSmartText(nextCommitted, combined);
                }
              } else if (interimRef.current) {
                nextCommitted = appendSmartText(nextCommitted, interimRef.current);
              }
              syncTextState(nextCommitted, '');
            } else if (chunk) {
              const nextInterim = appendSmartText(interimRef.current, chunk);
              syncTextState(committedRef.current, nextInterim);
            }
          } else if (msg.type === 'turn_complete') {
            if (interimRef.current) {
              const merged = appendSmartText(committedRef.current, interimRef.current);
              syncTextState(merged, '');
            }
          } else if (msg.type === 'error') {
            setWsStatus({ text: 'FAULT', tone: 'error' });
            onNotify(msg.message || 'Transcription error occurred.', 'error');
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onerror = () => {
        setWsStatus({ text: 'LINK ERR', tone: 'error' });
        onNotify('WebSocket connection error.', 'error');
      };

      ws.onclose = () => {
        if (isRecordingRef.current) {
          cleanupAudioAndSocket({ skipWsClose: true });
        } else {
          setWsStatus({ text: 'STANDBY', tone: 'neutral' });
        }
      };

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioCtx({ sampleRate: 16000 });
      audioCtxRef.current = audioContext;
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const sourceNode = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = sourceNode;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.72;
      sourceNode.connect(analyser);
      analyserRef.current = analyser;

      const handlePcmFrame = (float32Chunk) => {
        setMicLevel(calculateLevelPercent(float32Chunk));
        if (ws.readyState === WebSocket.OPEN) {
          const pcmBytes = downsampleTo16kPcm(float32Chunk, audioContext.sampleRate);
          ws.send(pcmBytes);
        }
      };

      if (audioContext.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        const blobUrl = URL.createObjectURL(
          new Blob([PCM_WORKLET_CODE], { type: 'application/javascript' })
        );
        await audioContext.audioWorklet.addModule(blobUrl);
        URL.revokeObjectURL(blobUrl);

        const workletNode = new AudioWorkletNode(audioContext, 'pcm-capture-processor');
        workletNode.port.onmessage = (e) => handlePcmFrame(e.data);
        sourceNode.connect(workletNode);
        workletNode.connect(audioContext.destination);
        workletNodeRef.current = workletNode;
      } else {
        const scriptNode = audioContext.createScriptProcessor(4096, 1, 1);
        scriptNode.onaudioprocess = (e) => {
          handlePcmFrame(e.inputBuffer.getChannelData(0));
        };
        sourceNode.connect(scriptNode);
        scriptNode.connect(audioContext.destination);
        scriptNodeRef.current = scriptNode;
      }

      isRecordingRef.current = true;
      setIsRecording(true);
      startSpectrumLoop();
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Could not start microphone:', err);
      onNotify(err.message || 'Microphone access denied.', 'error');
      cleanupAudioAndSocket();
    }
  }

  function handleToggleEdit() {
    if (isRecording) {
      onNotify('Stop capture before manually editing the script.', 'info');
      return;
    }

    if (!isEditing) {
      const fullText = appendSmartText(committedRef.current, interimRef.current).trim();
      setEditDraft(fullText);
      setIsEditing(true);
    } else {
      syncTextState(editDraft.trim(), '');
      setIsEditing(false);
    }
  }

  function handleClear() {
    if (isRecording) {
      cleanupAudioAndSocket();
    }
    syncTextState('', '');
    setEditDraft('');
    setTitle('');
    setElapsedSeconds(0);
  }

  async function handleSave() {
    const content = (
      isEditing
        ? editDraft
        : appendSmartText(committedRef.current, interimRef.current)
    ).trim();

    if (!content) {
      onNotify('Record or enter a transcript before archiving.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/transcriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || 'Untitled Tape',
          content,
          language_mode: languageMode,
          duration_seconds: elapsedSeconds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save transcript.');
      }

      onNotify('Archived to Neon PostgreSQL!', 'success');
      setTitle('');
      syncTextState('', '');
      setEditDraft('');
      setIsEditing(false);
      setElapsedSeconds(0);
      await onSaved();
    } catch (err) {
      onNotify(err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  }

  const fullDisplayText = isEditing
    ? editDraft
    : appendSmartText(committedText, interimText);
  const wordCount = fullDisplayText.trim()
    ? fullDisplayText.trim().split(/\s+/).length
    : 0;
  const scriptBadge = detectScriptBadge(fullDisplayText);
  const hasText = Boolean(committedText || interimText);
  const showInterimSpace =
    Boolean(committedText && interimText) &&
    !/\s$/.test(committedText) &&
    !/^\s/.test(interimText);

  return (
    <section className="lg:col-span-5 space-y-4">
      <div className="editorial-card rounded-xl overflow-hidden">
        {/* Top Deck Bar */}
        <div className="px-5 py-3.5 border-b border-[#D6CFC2] bg-[#FAF7F0] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="font-mono-tech text-[11px] font-semibold tracking-widest uppercase px-2 py-0.5 rounded bg-[#171614] text-[#FDFBF7]">
              DECK A
            </span>
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-[#171614]">
              Live Capture Console
            </h2>
          </div>

          <span
            className={`font-mono-tech text-[11px] font-semibold tracking-wider px-2.5 py-0.5 rounded-full border ${
              wsStatus.tone === 'live'
                ? 'bg-[#E04428]/10 text-[#E04428] border-[#E04428]/40'
                : wsStatus.tone === 'connecting'
                ? 'bg-amber-500/15 text-amber-800 border-amber-500/40'
                : wsStatus.tone === 'error'
                ? 'bg-red-500/15 text-red-700 border-red-500/40'
                : 'bg-[#EDE8DD] text-[#656057] border-[#D6CFC2]'
            }`}
          >
            {wsStatus.text}
          </span>
        </div>

        <div className="p-5 space-y-5">
          {/* Dark Hardware Telemetry & Spectrum Analyzer */}
          <div className="rounded-lg bg-[#171614] text-[#F5F2EB] p-4 border border-[#171614] space-y-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    isRecording
                      ? 'bg-[#E04428] on-air-dot shadow-[0_0_10px_#E04428]'
                      : 'bg-[#4E4A42]'
                  }`}
                />
                <span className="font-mono-tech text-xs tracking-widest uppercase text-[#CFC8BA]">
                  {isRecording ? 'ON AIR · CAPTURING 16kHz PCM' : 'MIC STANDBY · READY'}
                </span>
              </div>

              <div className="font-mono-tech text-2xl font-semibold tracking-tight tabular-nums text-[#FDFBF7]">
                {formatDuration(elapsedSeconds)}
              </div>
            </div>

            {/* 24-Bar Real-Time Spectrum Meter */}
            <div className="h-14 bg-[#0E0D0C] rounded-md px-2.5 py-2 border border-[#2C2A25] flex items-end gap-1">
              {spectrumBars.map((heightPct, idx) => {
                const isPeak = heightPct > 72;
                const isMid = heightPct > 42 && heightPct <= 72;
                const barColor = !isRecording
                  ? 'bg-[#2E2B26]'
                  : isPeak
                  ? 'bg-[#E04428]'
                  : isMid
                  ? 'bg-[#E89B3C]'
                  : 'bg-[#4ADE80]';
                return (
                  <div
                    key={idx}
                    style={{ height: `${isRecording ? heightPct : 10}%` }}
                    className={`flex-1 rounded-[2px] transition-all duration-75 ${barColor}`}
                  />
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 pt-0.5">
              <button
                type="button"
                onClick={isRecording ? () => cleanupAudioAndSocket() : startRecording}
                className={`tactile-btn inline-flex items-center gap-2.5 px-4 py-2.5 rounded-md font-display text-xs font-bold uppercase tracking-wider cursor-pointer border ${
                  isRecording
                    ? 'bg-[#E04428] text-white border-[#FF7B63] shadow-[3px_3px_0px_#000000]'
                    : 'bg-[#FDFBF7] text-[#171614] border-[#FDFBF7] hover:bg-[#EDE8DD] shadow-[3px_3px_0px_#4A463E]'
                }`}
              >
                <span
                  className={`w-2.5 h-2.5 ${
                    isRecording ? 'bg-white rounded-[2px]' : 'bg-[#E04428] rounded-full'
                  }`}
                />
                {isRecording ? 'Stop Capture' : 'Start Microphone'}
              </button>

              <div className="font-mono-tech text-[11px] text-[#9E978B] text-right">
                <div>INPUT GAIN: {micLevel}%</div>
                <div>FORMAT: PCM16 MONO</div>
              </div>
            </div>
          </div>

          {/* Session Title */}
          <div>
            <label
              htmlFor="sessionTitle"
              className="block font-mono-tech text-[11px] font-semibold uppercase tracking-wider text-[#656057] mb-1.5"
            >
              Tape Title / Session Label
            </label>
            <input
              id="sessionTitle"
              type="text"
              maxLength={255}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Delhi Client Sync — Hinglish Notes"
              className="w-full rounded-md border border-[#C9C1B2] bg-[#FFFFFF] px-3 py-2 text-sm text-[#171614] placeholder:text-[#A39C8F] focus:outline-none focus:border-[#171614] focus:ring-1 focus:ring-[#171614]"
            />
          </div>

          {/* Tactile Language Mode Pills */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono-tech text-[11px] font-semibold uppercase tracking-wider text-[#656057]">
                Recognition Mode
              </span>
              <span className="font-mono-tech text-[10px] text-[#857F74]">
                {languageMode}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGE_MODES.map((m) => {
                const active = languageMode === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    disabled={isRecording}
                    onClick={() => setLanguageMode(m.value)}
                    title={m.label}
                    className={`font-mono-tech text-[11px] font-medium px-2.5 py-1.5 rounded-md border transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      active
                        ? 'bg-[#171614] text-[#FDFBF7] border-[#171614]'
                        : 'bg-[#F5F2EB] text-[#49453E] border-[#D6CFC2] hover:border-[#171614]'
                    }`}
                  >
                    {m.short}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Editorial Script Sheet */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono-tech text-[11px] font-semibold uppercase tracking-wider text-[#656057]">
                  Live Script Sheet
                </span>
                {scriptBadge && (
                  <span
                    className={`font-mono-tech text-[10px] font-semibold px-2 py-0.5 rounded border ${
                      scriptBadge.tone === 'bilingual'
                        ? 'bg-[#E04428]/10 text-[#B92D14] border-[#E04428]/30'
                        : scriptBadge.tone === 'hindi'
                        ? 'bg-amber-500/15 text-amber-900 border-amber-500/30'
                        : 'bg-[#EDE8DD] text-[#49453E] border-[#D6CFC2]'
                    }`}
                  >
                    {scriptBadge.label}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <span className="font-mono-tech text-[11px] text-[#857F74]">
                  {wordCount} {wordCount === 1 ? 'WORD' : 'WORDS'}
                </span>
                <button
                  type="button"
                  onClick={handleToggleEdit}
                  className="font-mono-tech text-[11px] font-semibold uppercase tracking-wider text-[#171614] underline underline-offset-4 hover:text-[#E04428] cursor-pointer"
                >
                  {isEditing ? 'Done Editing' : 'Edit Script'}
                </button>
              </div>
            </div>

            {isEditing ? (
              <textarea
                rows={8}
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                placeholder="Refine your multilingual script before saving..."
                className="transcript-font w-full rounded-md border-2 border-[#171614] bg-white p-4 text-[15px] leading-relaxed text-[#171614] focus:outline-none"
              />
            ) : (
              <div
                ref={displayBoxRef}
                className="transcript-font transcript-scroll min-h-[210px] max-h-[310px] overflow-y-auto rounded-md border border-[#C9C1B2] bg-[#FFFFFF] p-4 pl-5 text-[15px] leading-[1.8] text-[#171614] whitespace-pre-wrap relative"
                style={{
                  borderLeft: '4px solid #E04428',
                }}
              >
                {!hasText && (
                  <span className="text-[#9E978B] text-sm">
                    Press <strong className="font-semibold text-[#171614]">Start Microphone</strong>{' '}
                    and speak naturally. Switch mid-sentence between Hindi (e.g., &ldquo;Kal subah
                    meeting schedule karni hai&rdquo;) and English — words stream live here.
                  </span>
                )}
                <span className="text-[#171614]">{committedText}</span>
                {interimText && (
                  <span className="bg-amber-100/90 text-[#8F3F00] px-1 rounded-xs border-b-2 border-[#C26A1B]">
                    {showInterimSpace ? ` ${interimText}` : interimText}
                  </span>
                )}
                {isRecording && (
                  <span className="inline-block w-0.5 h-4 bg-[#E04428] align-middle ml-1 on-air-dot" />
                )}
              </div>
            )}
          </div>

          {/* Deck Footer Actions */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={handleClear}
              className="tactile-btn font-mono-tech text-xs font-semibold uppercase tracking-wider px-4 py-2.5 rounded-md border border-[#C9C1B2] bg-[#F5F2EB] text-[#171614] hover:bg-[#EAE4D7] cursor-pointer"
            >
              Reset Tape
            </button>

            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="tactile-btn inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider px-5 py-2.5 rounded-md border border-[#171614] bg-[#176B3A] text-[#FDFBF7] hover:bg-[#135830] shadow-[3px_3px_0px_#171614] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
                />
              </svg>
              {isSaving ? 'Archiving...' : 'Archive to DB'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

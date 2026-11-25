import { useEffect, useRef, useState } from 'react';
import {
  PCM_WORKLET_CODE,
  appendSmartText,
  calculateLevelPercent,
  detectScriptBadge,
  downsampleTo16kPcm,
  formatDuration,
} from '../utils/audio.js';

const LANGUAGE_MODES = [
  { short: 'Auto', label: 'Auto (Multilingual / Code-Switch)', value: 'Auto (Multilingual)', codes: [] },
  { short: 'HI + EN', label: 'Hindi + English Hint', value: 'Hindi + English (hi-IN, en-IN)', codes: ['hi-IN', 'en-IN'] },
  { short: 'Hindi', label: 'Hindi (hi-IN)', value: 'Hindi (hi-IN)', codes: ['hi-IN'] },
  { short: 'EN-IN', label: 'English India (en-IN)', value: 'English India (en-IN)', codes: ['en-IN'] },
  { short: 'EN-US', label: 'English US (en-US)', value: 'English US (en-US)', codes: ['en-US'] },
];

export default function LiveStudio({ onSaved, onNotify }) {
  const [title, setTitle] = useState('');
  const [languageMode, setLanguageMode] = useState('Auto (Multilingual)');
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [wsStatus, setWsStatus] = useState({ text: 'Standby', tone: 'neutral' });

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
  const canvasRef = useRef(null);
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

  // Draw crisp glowing waveform on canvas (both idle breathing curve & live audio oscilloscope)
  useEffect(() => {
    let animId;
    let phase = 0;

    const renderWave = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
        canvas.width = Math.max(1, Math.floor(rect.width * dpr));
        canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      }

      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;
      const midY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Subtle center reference line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(width, midY);
      ctx.stroke();

      const analyser = analyserRef.current;
      if (isRecordingRef.current && analyser) {
        const bufferLen = analyser.fftSize;
        const timeData = new Uint8Array(bufferLen);
        analyser.getByteTimeDomainData(timeData);

        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, '#22D3EE');
        gradient.addColorStop(0.5, '#34D399');
        gradient.addColorStop(1, '#22D3EE');

        // Glow stroke
        ctx.save();
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2.2 * dpr;
        ctx.shadowColor = 'rgba(34, 211, 238, 0.65)';
        ctx.shadowBlur = 12 * dpr;
        ctx.beginPath();

        const sliceWidth = width / bufferLen;
        let x = 0;
        for (let i = 0; i < bufferLen; i++) {
          const v = (timeData[i] - 128) / 128;
          const y = midY + v * (height * 0.42);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.stroke();
        ctx.restore();
      } else {
        // Calm idle sine wave
        phase += 0.035;
        ctx.save();
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.28)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        const points = 90;
        for (let i = 0; i <= points; i++) {
          const t = i / points;
          const envelope = Math.sin(t * Math.PI);
          const y = midY + Math.sin(t * 10 + phase) * (4.5 * dpr) * envelope;
          const x = t * width;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }

      animId = requestAnimationFrame(renderWave);
    };

    animId = requestAnimationFrame(renderWave);
    rafRef.current = animId;
    return () => cancelAnimationFrame(animId);
  }, []);

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

  function cleanupAudioAndSocket({ skipWsClose = false } = {}) {
    isRecordingRef.current = false;
    setIsRecording(false);

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
    setWsStatus({ text: 'Standby', tone: 'neutral' });
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
      setWsStatus({ text: 'Connecting...', tone: 'connecting' });

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
              setWsStatus({ text: `Live · ${msg.model}`, tone: 'live' });
            } else if (msg.status === 'connecting') {
              setWsStatus({ text: 'Syncing Gemini...', tone: 'connecting' });
            } else if (msg.status === 'stopped' || msg.status === 'closed') {
              if (!isRecordingRef.current) {
                setWsStatus({ text: 'Standby', tone: 'neutral' });
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
            setWsStatus({ text: 'Error', tone: 'error' });
            onNotify(msg.message || 'Transcription error occurred.', 'error');
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onerror = () => {
        setWsStatus({ text: 'WS Error', tone: 'error' });
        onNotify('WebSocket connection error.', 'error');
      };

      ws.onclose = () => {
        if (isRecordingRef.current) {
          cleanupAudioAndSocket({ skipWsClose: true });
        } else {
          setWsStatus({ text: 'Standby', tone: 'neutral' });
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
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
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
      onNotify('Stop recording before editing the transcript.', 'info');
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
      onNotify('Record or enter a transcript before saving.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/transcriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || 'Untitled Transcript',
          content,
          language_mode: languageMode,
          duration_seconds: elapsedSeconds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save transcript.');
      }

      onNotify('Saved to Neon PostgreSQL!', 'success');
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
      <div className="obsidian-panel rounded-2xl p-5 space-y-5">
        {/* Header Row */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22D3EE]" />
              <h2 className="text-sm font-semibold tracking-wide text-white uppercase">
                Live Audio Stage
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Stream 16kHz PCM &amp; switch languages mid-sentence.
            </p>
          </div>

          <span
            className={`font-mono-lab text-[11px] font-medium px-2.5 py-1 rounded-full border ${
              wsStatus.tone === 'live'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : wsStatus.tone === 'connecting'
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                : wsStatus.tone === 'error'
                ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                : 'bg-white/[0.04] text-slate-400 border-white/10'
            }`}
          >
            {wsStatus.text}
          </span>
        </div>

        {/* Live Oscilloscope Waveform Bay */}
        <div className="obsidian-subpanel rounded-xl p-4 space-y-3.5 relative overflow-hidden">
          <div className="flex items-center justify-between text-[11px] font-mono-lab">
            <span className={isRecording ? 'text-cyan-300' : 'text-slate-500'}>
              {isRecording ? '● STREAMING 16kHz MONO' : '○ OSCILLOSCOPE IDLE'}
            </span>
            <span className="text-slate-400">GAIN {micLevel}%</span>
          </div>

          <div className="h-20 w-full rounded-lg bg-[#07090C] border border-white/[0.05] overflow-hidden">
            <canvas ref={canvasRef} className="w-full h-full block" />
          </div>

          {/* Transport Controls */}
          <div className="flex items-center justify-between gap-3 pt-0.5">
            <button
              type="button"
              onClick={isRecording ? () => cleanupAudioAndSocket() : startRecording}
              className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition cursor-pointer ${
                isRecording
                  ? 'bg-rose-500 text-white hover:bg-rose-600 rec-pulse'
                  : 'bg-cyan-400 text-[#090B0E] hover:bg-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.28)]'
              }`}
            >
              <span
                className={`w-2.5 h-2.5 ${
                  isRecording ? 'bg-white rounded-[2px]' : 'bg-[#090B0E] rounded-full'
                }`}
              />
              {isRecording ? 'Stop Microphone' : 'Start Microphone'}
            </button>

            <div className="text-right">
              <div className="font-mono-lab text-[10px] uppercase tracking-widest text-slate-500">
                Session Timer
              </div>
              <div className="font-mono-lab text-xl font-semibold text-white tabular-nums">
                {formatDuration(elapsedSeconds)}
              </div>
            </div>
          </div>
        </div>

        {/* Session Title */}
        <div>
          <label
            htmlFor="sessionTitle"
            className="block font-mono-lab text-[11px] uppercase tracking-wider text-slate-400 mb-1.5"
          >
            Session Title
          </label>
          <input
            id="sessionTitle"
            type="text"
            maxLength={255}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Hinglish Product Standup"
            className="w-full rounded-xl border border-white/10 bg-[#0C0F14] px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/40 transition"
          />
        </div>

        {/* Language Mode Pills */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-mono-lab text-[11px] uppercase tracking-wider text-slate-400">
              Language Detection
            </span>
            <span className="font-mono-lab text-[10px] text-slate-500">{languageMode}</span>
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
                  className={`font-mono-lab text-[11px] font-medium px-2.5 py-1.5 rounded-lg border transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                    active
                      ? 'bg-cyan-400/15 text-cyan-200 border-cyan-400/50'
                      : 'bg-white/[0.03] text-slate-400 border-white/10 hover:border-white/25 hover:text-slate-200'
                  }`}
                >
                  {m.short}
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Transcript Feed */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono-lab text-[11px] uppercase tracking-wider text-slate-400">
                Live Output
              </span>
              {scriptBadge && (
                <span
                  className={`font-mono-lab text-[10px] px-2 py-0.5 rounded-full border ${
                    scriptBadge.tone === 'bilingual'
                      ? 'bg-amber-400/10 text-amber-300 border-amber-400/30'
                      : scriptBadge.tone === 'hindi'
                      ? 'bg-cyan-400/10 text-cyan-300 border-cyan-400/30'
                      : 'bg-white/[0.05] text-slate-300 border-white/10'
                  }`}
                >
                  {scriptBadge.label}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <span className="font-mono-lab text-[11px] text-slate-500">
                {wordCount} {wordCount === 1 ? 'word' : 'words'}
              </span>
              <button
                type="button"
                onClick={handleToggleEdit}
                className="font-mono-lab text-[11px] text-cyan-300 hover:text-cyan-200 transition cursor-pointer"
              >
                {isEditing ? 'Done' : 'Edit'}
              </button>
            </div>
          </div>

          {isEditing ? (
            <textarea
              rows={8}
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              placeholder="Edit your transcript before saving..."
              className="transcript-font w-full rounded-xl border border-cyan-400/50 bg-[#0C0F14] p-4 text-sm leading-relaxed text-slate-100 focus:outline-none"
            />
          ) : (
            <div
              ref={displayBoxRef}
              className="transcript-font lab-scroll min-h-[205px] max-h-[300px] overflow-y-auto rounded-xl border border-white/10 bg-[#0C0F14] p-4 text-[14.5px] leading-[1.8] text-slate-100 whitespace-pre-wrap"
            >
              {!hasText && (
                <span className="text-slate-500 text-sm">
                  Click <span className="text-cyan-300 font-medium">Start Microphone</span> and
                  speak naturally in Hindi, English, or mixed Hinglish — live captions stream here.
                </span>
              )}
              <span className="text-slate-100">{committedText}</span>
              {interimText && (
                <span className="text-cyan-300 bg-cyan-400/10 border-b border-cyan-400/60 px-1 rounded-xs">
                  {showInterimSpace ? ` ${interimText}` : interimText}
                </span>
              )}
              {isRecording && (
                <span className="inline-block w-0.5 h-4 bg-cyan-400 align-middle ml-1 animate-pulse" />
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={handleClear}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] hover:text-white transition cursor-pointer"
          >
            Clear
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-[#06140E] bg-emerald-400 hover:bg-emerald-300 shadow-[0_0_20px_rgba(52,211,153,0.22)] disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
              />
            </svg>
            {isSaving ? 'Saving...' : 'Save to Database'}
          </button>
        </div>
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  PCM_WORKLET_CODE,
  appendSmartText,
  calculateLevelPercent,
  downsampleTo16kPcm,
  formatDuration,
} from '../utils/audio.js';

const LANGUAGE_MODES = [
  { label: 'Auto (Multilingual / Code-Switch)', value: 'Auto (Multilingual)', codes: [] },
  { label: 'Hindi + English Hint', value: 'Hindi + English (hi-IN, en-IN)', codes: ['hi-IN', 'en-IN'] },
  { label: 'Hindi (hi-IN)', value: 'Hindi (hi-IN)', codes: ['hi-IN'] },
  { label: 'English India (en-IN)', value: 'English India (en-IN)', codes: ['en-IN'] },
  { label: 'English US (en-US)', value: 'English US (en-US)', codes: ['en-US'] },
];

const WS_TONE_CLASSES = {
  neutral: 'bg-slate-100 text-slate-600',
  connecting: 'bg-amber-100 text-amber-800',
  live: 'bg-emerald-100 text-emerald-800',
  error: 'bg-rose-100 text-rose-800',
};

export default function LiveStudio({ onSaved, onNotify }) {
  const [title, setTitle] = useState('');
  const [languageMode, setLanguageMode] = useState('Auto (Multilingual)');
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [wsStatus, setWsStatus] = useState({ text: 'Idle', tone: 'neutral' });

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
    setWsStatus({ text: 'Idle', tone: 'neutral' });
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
              setWsStatus({ text: `Live (${msg.model})`, tone: 'live' });
            } else if (msg.status === 'connecting') {
              setWsStatus({ text: 'Connecting Gemini...', tone: 'connecting' });
            } else if (msg.status === 'stopped' || msg.status === 'closed') {
              if (!isRecordingRef.current) {
                setWsStatus({ text: 'Idle', tone: 'neutral' });
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
          setWsStatus({ text: 'Idle', tone: 'neutral' });
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
      onNotify('Stop recording before manually editing text.', 'info');
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

      onNotify('Transcription saved to PostgreSQL!', 'success');
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

  const hasText = Boolean(committedText || interimText);
  const showInterimSpace =
    Boolean(committedText && interimText) &&
    !/\s$/.test(committedText) &&
    !/^\s/.test(interimText);

  return (
    <section className="lg:col-span-5 space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Live Transcription Studio</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Speak naturally — switch between Hindi, English &amp; 90+ languages mid-sentence.
            </p>
          </div>
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-medium shrink-0 ${
              WS_TONE_CLASSES[wsStatus.tone] || WS_TONE_CLASSES.neutral
            }`}
          >
            {wsStatus.text}
          </span>
        </div>

        {/* Session Title & Language Mode */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="sessionTitle" className="block text-xs font-medium text-slate-600 mb-1">
              Session Title
            </label>
            <input
              id="sessionTitle"
              type="text"
              maxLength={255}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Hinglish Product Standup"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="languageMode" className="block text-xs font-medium text-slate-600 mb-1">
              Language Mode
            </label>
            <select
              id="languageMode"
              value={languageMode}
              disabled={isRecording}
              onChange={(e) => setLanguageMode(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
            >
              {LANGUAGE_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Microphone Controls + Timer + Level Meter */}
        <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={isRecording ? () => cleanupAudioAndSocket() : startRecording}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition shadow-sm cursor-pointer ${
                isRecording
                  ? 'bg-rose-600 hover:bg-rose-700 recording-active'
                  : 'bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99]'
              }`}
            >
              <span
                className={`w-2.5 h-2.5 bg-white ${
                  isRecording ? 'rounded-sm' : 'rounded-full'
                }`}
              />
              <span>{isRecording ? 'Stop Microphone' : 'Start Microphone'}</span>
            </button>

            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                Duration
              </div>
              <div className="text-lg font-mono font-semibold text-slate-800">
                {formatDuration(elapsedSeconds)}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Input Audio Level (16kHz PCM)</span>
              <span>{micLevel}%</span>
            </div>
            <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                style={{ width: `${micLevel}%` }}
                className="h-full bg-gradient-to-r from-emerald-500 via-indigo-500 to-rose-500 transition-all duration-75"
              />
            </div>
          </div>
        </div>

        {/* Live Transcript Box */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Live Transcript</span>
            <button
              type="button"
              onClick={handleToggleEdit}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700 cursor-pointer"
            >
              {isEditing ? 'Done Editing' : 'Edit Text'}
            </button>
          </div>

          {isEditing ? (
            <textarea
              rows={8}
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              placeholder="Edit your transcript before saving..."
              className="transcript-font w-full rounded-xl border border-indigo-300 bg-white p-4 text-sm leading-relaxed text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          ) : (
            <div
              ref={displayBoxRef}
              className="transcript-font transcript-scroll min-h-[200px] max-h-[320px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap"
            >
              {!hasText && (
                <span className="text-slate-400">
                  Click &quot;Start Microphone&quot; and start speaking. Your real-time multilingual
                  transcription will appear here...
                </span>
              )}
              <span className="text-slate-900">{committedText}</span>
              {interimText && (
                <span className="text-indigo-600 bg-indigo-50/90 rounded px-1 italic">
                  {showInterimSpace ? ` ${interimText}` : interimText}
                </span>
              )}
              {isRecording && (
                <span className="inline-block w-0.5 h-4 bg-indigo-600 align-middle ml-0.5 animate-pulse" />
              )}
            </div>
          )}
        </div>

        {/* Studio Action Buttons */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={handleClear}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
          >
            Clear
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-sm cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
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

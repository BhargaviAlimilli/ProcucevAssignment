import { useEffect, useState } from 'react';
import { detectScriptBadge, formatDuration } from '../utils/audio.js';

const TTS_VOICES = [
  { code: 'hi-IN', label: 'hi-IN' },
  { code: 'en-IN', label: 'en-IN' },
  { code: 'en-US', label: 'en-US' },
];

function formatDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HistoryDashboard({
  transcriptions,
  loading,
  error,
  searchQuery,
  onSearchChange,
  onRefresh,
  onEdit,
  onDelete,
  onNotify,
}) {
  const [ttsLang, setTtsLang] = useState('en-IN');
  const [activeTtsId, setActiveTtsId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  useEffect(() => {
    if ('speechSynthesis' in window && typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function stopSpeech() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setActiveTtsId(null);
  }

  function handleSpeak(item) {
    if (!('speechSynthesis' in window)) {
      onNotify('Web Speech API TTS is not supported in this browser.', 'error');
      return;
    }

    if (activeTtsId === item.id) {
      stopSpeech();
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(item.content);
    utterance.lang = ttsLang;

    const voices = window.speechSynthesis.getVoices();
    const matchingVoice =
      voices.find((v) => v.lang.toLowerCase() === ttsLang.toLowerCase()) ||
      voices.find((v) => v.lang.toLowerCase().startsWith(ttsLang.split('-')[0]));

    if (matchingVoice) {
      utterance.voice = matchingVoice;
    }

    utterance.onend = () => setActiveTtsId(null);
    utterance.onerror = () => setActiveTtsId(null);

    setActiveTtsId(item.id);
    window.speechSynthesis.speak(utterance);
  }

  async function handleCopy(item) {
    try {
      await navigator.clipboard.writeText(item.content);
      setCopiedId(item.id);
      onNotify('Copied transcript to clipboard.', 'success');
      setTimeout(() => {
        setCopiedId((prev) => (prev === item.id ? null : prev));
      }, 1500);
    } catch {
      onNotify('Clipboard permission denied.', 'error');
    }
  }

  async function handleConfirmDelete(id) {
    if (activeTtsId === id) {
      stopSpeech();
    }
    setConfirmDeleteId(null);
    await onDelete(id);
  }

  const totalSeconds = transcriptions.reduce(
    (acc, item) => acc + (Number(item.duration_seconds) || 0),
    0
  );
  const bilingualCount = transcriptions.filter(
    (item) => detectScriptBadge(item.content)?.tone === 'bilingual'
  ).length;

  return (
    <section className="lg:col-span-7 space-y-4">
      <div className="obsidian-panel rounded-2xl p-5 space-y-4">
        {/* Header & Metrics */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34D399]" />
              <h2 className="text-sm font-semibold tracking-wide text-white uppercase">
                Transcription Vault
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Searchable PostgreSQL history with native browser TTS playback.
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono-lab text-[11px]">
            <span className="px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/10 text-slate-300">
              {transcriptions.length} saved
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/10 text-slate-300">
              {formatDuration(totalSeconds)}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-amber-400/10 border border-amber-400/25 text-amber-300">
              {bilingualCount} bilingual
            </span>
          </div>
        </div>

        {/* Search & TTS Voice Bar */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1">
              <svg
                className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                />
              </svg>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Filter by title, Hindi, or English text..."
                className="w-full rounded-xl border border-white/10 bg-[#0C0F14] pl-10 pr-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/30 transition"
              />
            </div>
            <button
              type="button"
              onClick={onRefresh}
              className="px-3 py-2 rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] hover:text-white text-xs font-medium transition cursor-pointer"
            >
              Refresh
            </button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono-lab text-[10px] uppercase tracking-wider text-slate-500 mr-1">
              TTS Voice
            </span>
            {TTS_VOICES.map((voice) => {
              const active = ttsLang === voice.code;
              return (
                <button
                  key={voice.code}
                  type="button"
                  onClick={() => setTtsLang(voice.code)}
                  className={`font-mono-lab text-[11px] px-2.5 py-1.5 rounded-lg border transition cursor-pointer ${
                    active
                      ? 'bg-cyan-400/15 text-cyan-200 border-cyan-400/50'
                      : 'bg-white/[0.03] text-slate-400 border-white/10 hover:border-white/25 hover:text-slate-200'
                  }`}
                >
                  {voice.label}
                </button>
              );
            })}
            {activeTtsId !== null && (
              <button
                type="button"
                onClick={stopSpeech}
                className="font-mono-lab text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 cursor-pointer"
              >
                Stop
              </button>
            )}
          </div>
        </div>

        {/* History List */}
        <div className="space-y-3">
          {loading ? (
            <div className="rounded-xl border border-dashed border-white/10 py-12 text-center font-mono-lab text-xs text-slate-500">
              Loading saved transcripts...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              {error}
            </div>
          ) : transcriptions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-[#0C0F14]/60 py-14 px-6 text-center space-y-1.5">
              <div className="text-sm font-medium text-slate-300">No transcriptions saved yet</div>
              <p className="text-xs text-slate-500">
                Capture speech on the left stage and click{' '}
                <span className="text-emerald-300">Save to Database</span> to archive it here.
              </p>
            </div>
          ) : (
            transcriptions.map((item) => {
              const isPlaying = activeTtsId === item.id;
              const isConfirmingDelete = confirmDeleteId === item.id;
              const scriptBadge = detectScriptBadge(item.content);

              return (
                <article
                  key={item.id}
                  className={`rounded-xl border p-4 space-y-3 transition ${
                    isPlaying
                      ? 'border-cyan-400/60 bg-cyan-500/[0.06] shadow-[0_0_24px_rgba(34,211,238,0.12)]'
                      : 'border-white/[0.08] bg-[#0C0F14] hover:border-white/20'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono-lab text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-400">
                          #{String(item.id).padStart(3, '0')}
                        </span>
                        <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                        {isPlaying && (
                          <span className="inline-flex items-end gap-0.5 h-3.5 px-1.5 py-0.5 rounded bg-cyan-400/15">
                            <span className="w-0.5 h-full bg-cyan-400 tts-eq-bar" />
                            <span
                              className="w-0.5 h-full bg-cyan-400 tts-eq-bar"
                              style={{ animationDelay: '0.15s' }}
                            />
                            <span
                              className="w-0.5 h-full bg-cyan-400 tts-eq-bar"
                              style={{ animationDelay: '0.3s' }}
                            />
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 font-mono-lab text-[11px] text-slate-400">
                        {scriptBadge && (
                          <span
                            className={`px-2 py-0.5 rounded-full border text-[10px] ${
                              scriptBadge.tone === 'bilingual'
                                ? 'bg-amber-400/10 text-amber-300 border-amber-400/25'
                                : scriptBadge.tone === 'hindi'
                                ? 'bg-cyan-400/10 text-cyan-300 border-cyan-400/25'
                                : 'bg-white/[0.04] text-slate-300 border-white/10'
                            }`}
                          >
                            {scriptBadge.label}
                          </span>
                        )}
                        <span>{item.language_mode || 'Auto'}</span>
                        <span>·</span>
                        <span>{formatDuration(item.duration_seconds)}</span>
                        <span>·</span>
                        <span className="text-slate-500">{formatDate(item.created_at)}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleSpeak(item)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer ${
                          isPlaying
                            ? 'bg-rose-500/20 text-rose-200 border-rose-500/40 hover:bg-rose-500/30'
                            : 'bg-white/[0.04] text-slate-200 border-white/10 hover:border-cyan-400/40 hover:text-cyan-200'
                        }`}
                      >
                        {isPlaying ? 'Stop' : 'Listen'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopy(item)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-white/[0.04] text-slate-200 border-white/10 hover:border-white/25 transition cursor-pointer"
                      >
                        {copiedId === item.id ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(item)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-white/[0.04] text-slate-200 border-white/10 hover:border-white/25 transition cursor-pointer"
                      >
                        Edit
                      </button>

                      {isConfirmingDelete ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleConfirmDelete(item.id)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-500 text-white hover:bg-rose-600 cursor-pointer"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1.5 rounded-lg text-xs font-medium bg-white/[0.05] text-slate-400 border border-white/10 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(item.id)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-rose-500/10 text-rose-300 border-rose-500/25 hover:bg-rose-500/20 transition cursor-pointer"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="transcript-font text-sm text-slate-300 leading-relaxed whitespace-pre-wrap break-words border-t border-white/[0.06] pt-3">
                    {item.content}
                  </p>
                </article>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

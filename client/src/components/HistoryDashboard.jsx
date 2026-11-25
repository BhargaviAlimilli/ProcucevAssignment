import { useEffect, useState } from 'react';
import { formatDuration } from '../utils/audio.js';

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

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.title}"? This action cannot be undone.`)) {
      return;
    }
    if (activeTtsId === item.id) {
      stopSpeech();
    }
    await onDelete(item.id);
  }

  return (
    <section className="lg:col-span-7 space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Saved Transcriptions
              <span className="ml-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                {transcriptions.length}
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Search, edit, copy, delete, or play back via browser Text-to-Speech.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="ttsLangSelect" className="text-xs font-medium text-slate-600 whitespace-nowrap">
              TTS Voice:
            </label>
            <select
              id="ttsLangSelect"
              value={ttsLang}
              onChange={(e) => setTtsLang(e.target.value)}
              className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="hi-IN">Hindi (hi-IN)</option>
              <option value="en-IN">English India (en-IN)</option>
              <option value="en-US">English US (en-US)</option>
            </select>
            {activeTtsId !== null && (
              <button
                type="button"
                onClick={stopSpeech}
                className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 cursor-pointer"
              >
                Stop Audio
              </button>
            )}
          </div>
        </div>

        {/* Search & Refresh Bar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <svg
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
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
              placeholder="Search saved transcripts by title or content..."
              className="w-full rounded-xl border border-slate-200 pl-10 pr-4 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium transition cursor-pointer"
          >
            Refresh
          </button>
        </div>

        {/* Saved Transcripts List */}
        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-12 text-sm text-slate-400">
              Loading saved transcriptions...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {error}
            </div>
          ) : transcriptions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 py-12 px-4 text-center text-sm text-slate-400">
              No saved transcriptions found. Record audio on the left and click &quot;Save to
              Database&quot;.
            </div>
          ) : (
            transcriptions.map((item) => {
              const isPlaying = activeTtsId === item.id;
              return (
                <article
                  key={item.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-white transition p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-medium">
                          {item.language_mode || 'Auto'}
                        </span>
                        <span>{formatDate(item.created_at)}</span>
                        <span>&bull;</span>
                        <span className="font-mono">{formatDuration(item.duration_seconds)}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleSpeak(item)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                          isPlaying
                            ? 'bg-rose-600 text-white hover:bg-rose-700'
                            : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {isPlaying ? 'Stop' : 'Listen'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopy(item)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                      >
                        {copiedId === item.id ? 'Copied!' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(item)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <p className="transcript-font text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
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

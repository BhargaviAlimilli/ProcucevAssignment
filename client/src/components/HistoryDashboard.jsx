import { useEffect, useState } from 'react';
import { detectScriptBadge, formatDuration } from '../utils/audio.js';

const TTS_VOICES = [
  { code: 'hi-IN', label: 'HI · hi-IN' },
  { code: 'en-IN', label: 'EN · en-IN' },
  { code: 'en-US', label: 'US · en-US' },
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
      onNotify('Transcript copied to clipboard.', 'success');
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
      <div className="editorial-card rounded-xl overflow-hidden">
        {/* Vault Header */}
        <div className="px-5 py-3.5 border-b border-[#D6CFC2] bg-[#FAF7F0] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="font-mono-tech text-[11px] font-semibold tracking-widest uppercase px-2 py-0.5 rounded bg-[#E04428] text-white">
              VAULT
            </span>
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-[#171614]">
              Archival Transcripts &amp; TTS Playback
            </h2>
          </div>

          <div className="flex items-center gap-3 font-mono-tech text-[11px] text-[#656057]">
            <span>{transcriptions.length} CLIPS</span>
            <span>/</span>
            <span>{formatDuration(totalSeconds)} TOTAL</span>
            <span>/</span>
            <span>{bilingualCount} BILINGUAL</span>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Search + TTS Voice Selector Bar */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1">
              <div className="relative flex-1">
                <svg
                  className="w-4 h-4 text-[#656057] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
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
                  placeholder="Search archive by title, Hindi, or English keywords..."
                  className="w-full rounded-md border border-[#C9C1B2] bg-white pl-9 pr-3 py-2 text-sm text-[#171614] placeholder:text-[#A39C8F] focus:outline-none focus:border-[#171614]"
                />
              </div>
              <button
                type="button"
                onClick={onRefresh}
                className="font-mono-tech text-xs font-semibold uppercase px-3 py-2 rounded-md border border-[#C9C1B2] bg-[#F5F2EB] text-[#171614] hover:bg-[#EAE4D7] cursor-pointer"
              >
                Sync
              </button>
            </div>

            {/* Segmented TTS Voice Deck */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mono-tech text-[10px] font-semibold uppercase tracking-wider text-[#656057] mr-1">
                TTS VOICE:
              </span>
              {TTS_VOICES.map((voice) => {
                const active = ttsLang === voice.code;
                return (
                  <button
                    key={voice.code}
                    type="button"
                    onClick={() => setTtsLang(voice.code)}
                    className={`font-mono-tech text-[11px] font-medium px-2.5 py-1.5 rounded-md border transition cursor-pointer ${
                      active
                        ? 'bg-[#171614] text-[#FDFBF7] border-[#171614]'
                        : 'bg-[#F5F2EB] text-[#49453E] border-[#D6CFC2] hover:border-[#171614]'
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
                  className="font-mono-tech text-[11px] font-semibold uppercase px-2.5 py-1.5 rounded-md bg-[#E04428] text-white hover:bg-[#C3361C] cursor-pointer"
                >
                  Stop Audio
                </button>
              )}
            </div>
          </div>

          {/* Saved Transcript Index Cards */}
          <div className="space-y-3">
            {loading ? (
              <div className="rounded-md border border-dashed border-[#C9C1B2] py-12 text-center font-mono-tech text-xs text-[#656057]">
                LOADING ARCHIVE FROM NEON POSTGRESQL...
              </div>
            ) : error ? (
              <div className="rounded-md border border-[#E04428] bg-[#E04428]/10 p-4 text-sm text-[#9B230E]">
                {error}
              </div>
            ) : transcriptions.length === 0 ? (
              <div className="rounded-md border border-dashed border-[#C9C1B2] bg-[#FAF7F0] py-14 px-6 text-center space-y-1.5">
                <div className="font-display text-sm font-bold text-[#171614]">
                  No Archived Tapes Yet
                </div>
                <p className="text-xs text-[#656057]">
                  Record multilingual speech in Deck A and click{' '}
                  <strong className="text-[#171614]">Archive to DB</strong> to store it here.
                </p>
              </div>
            ) : (
              transcriptions.map((item) => {
                const isPlaying = activeTtsId === item.id;
                const isConfirmingDelete = confirmDeleteId === item.id;
                const scriptBadge = detectScriptBadge(item.content);
                const paddedId = String(item.id).padStart(3, '0');

                return (
                  <article
                    key={item.id}
                    className={`rounded-md border p-4 space-y-3 transition ${
                      isPlaying
                        ? 'border-[#E04428] bg-[#FFF8F5] shadow-[3px_3px_0px_#E04428]'
                        : 'border-[#D6CFC2] bg-[#FFFFFF] hover:border-[#171614]'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono-tech text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#EDE8DD] text-[#49453E]">
                            #{paddedId}
                          </span>
                          <h3 className="font-display text-[15px] font-bold text-[#171614]">
                            {item.title}
                          </h3>
                          {isPlaying && (
                            <span className="inline-flex items-end gap-0.5 h-3.5 px-1.5 py-0.5 rounded bg-[#E04428]/10">
                              <span className="w-0.5 h-full bg-[#E04428] tts-wave-bar" />
                              <span
                                className="w-0.5 h-full bg-[#E04428] tts-wave-bar"
                                style={{ animationDelay: '0.15s' }}
                              />
                              <span
                                className="w-0.5 h-full bg-[#E04428] tts-wave-bar"
                                style={{ animationDelay: '0.3s' }}
                              />
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 font-mono-tech text-[11px] text-[#656057]">
                          {scriptBadge && (
                            <span
                              className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${
                                scriptBadge.tone === 'bilingual'
                                  ? 'bg-[#E04428]/10 text-[#B92D14] border-[#E04428]/30'
                                  : scriptBadge.tone === 'hindi'
                                  ? 'bg-amber-500/15 text-amber-900 border-amber-500/30'
                                  : 'bg-[#F5F2EB] text-[#49453E] border-[#D6CFC2]'
                              }`}
                            >
                              {scriptBadge.label}
                            </span>
                          )}
                          <span>{item.language_mode || 'Auto'}</span>
                          <span>·</span>
                          <span>{formatDuration(item.duration_seconds)}</span>
                          <span>·</span>
                          <span>{formatDate(item.created_at)}</span>
                        </div>
                      </div>

                      {/* Tactile Card Actions */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleSpeak(item)}
                          className={`font-mono-tech text-[11px] font-semibold uppercase px-2.5 py-1.5 rounded border transition cursor-pointer ${
                            isPlaying
                              ? 'bg-[#E04428] text-white border-[#E04428]'
                              : 'bg-[#F5F2EB] text-[#171614] border-[#C9C1B2] hover:border-[#171614]'
                          }`}
                        >
                          {isPlaying ? 'Stop' : 'Listen'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopy(item)}
                          className="font-mono-tech text-[11px] font-semibold uppercase px-2.5 py-1.5 rounded border bg-[#F5F2EB] text-[#171614] border-[#C9C1B2] hover:border-[#171614] transition cursor-pointer"
                        >
                          {copiedId === item.id ? 'Copied' : 'Copy'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onEdit(item)}
                          className="font-mono-tech text-[11px] font-semibold uppercase px-2.5 py-1.5 rounded border bg-[#F5F2EB] text-[#171614] border-[#C9C1B2] hover:border-[#171614] transition cursor-pointer"
                        >
                          Edit
                        </button>

                        {isConfirmingDelete ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleConfirmDelete(item.id)}
                              className="font-mono-tech text-[11px] font-semibold uppercase px-2.5 py-1.5 rounded bg-[#E04428] text-white border border-[#E04428] cursor-pointer"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="font-mono-tech text-[11px] font-semibold uppercase px-2 py-1.5 rounded bg-[#F5F2EB] text-[#656057] border border-[#C9C1B2] cursor-pointer"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(item.id)}
                            className="font-mono-tech text-[11px] font-semibold uppercase px-2.5 py-1.5 rounded border bg-white text-[#B92D14] border-[#E8B8AF] hover:bg-[#FFF2EF] transition cursor-pointer"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="transcript-font text-[14.5px] text-[#262420] leading-[1.75] whitespace-pre-wrap break-words border-t border-[#EFEAE0] pt-3">
                      {item.content}
                    </p>
                  </article>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

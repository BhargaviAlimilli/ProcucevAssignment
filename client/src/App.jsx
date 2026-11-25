import { useCallback, useEffect, useState } from 'react';
import LiveStudio from './components/LiveStudio.jsx';
import HistoryDashboard from './components/HistoryDashboard.jsx';
import EditModal from './components/EditModal.jsx';

const TOAST_PALETTE = {
  info: 'bg-[#171614] text-[#FDFBF7] border-[#171614]',
  success: 'bg-[#176B3A] text-[#FDFBF7] border-[#171614]',
  error: 'bg-[#E04428] text-[#FDFBF7] border-[#171614]',
};

export default function App() {
  const [health, setHealth] = useState(null);
  const [transcriptions, setTranscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  const [toasts, setToasts] = useState([]);

  const notify = useCallback((message, type = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setHealth(data);
    } catch {
      setHealth({ offline: true });
    }
  }, []);

  const fetchTranscriptions = useCallback(async (search = '') => {
    try {
      const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await fetch(`/api/transcriptions${query}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load history.');
      }
      setTranscriptions(data.transcriptions || []);
      setHistoryError('');
    } catch (err) {
      setHistoryError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchTranscriptions(searchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchTranscriptions]);

  async function handleUpdate(id, payload) {
    try {
      const res = await fetch(`/api/transcriptions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update transcript.');
      }
      setEditingItem(null);
      notify('Archived transcript updated.', 'success');
      await fetchTranscriptions(searchQuery);
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function handleDelete(id) {
    try {
      const res = await fetch(`/api/transcriptions/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete transcript.');
      }
      notify('Transcript removed from archive.', 'success');
      await fetchTranscriptions(searchQuery);
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Architectural Studio Header */}
      <header className="bg-[#FDFBF7] border-b-2 border-[#171614] sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            {/* Custom Tape-Reel Emblem */}
            <div className="w-10 h-10 rounded-md bg-[#171614] text-[#FDFBF7] flex items-center justify-center shadow-[2px_2px_0px_#E04428]">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="8" cy="12" r="3" />
                <circle cx="16" cy="12" r="3" />
                <path strokeLinecap="round" d="M8 15h8M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-lg sm:text-xl font-bold tracking-tight text-[#171614]">
                  VAANISTREAM
                </h1>
                <span className="font-mono-tech text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-[#E04428]/10 text-[#B92D14] border border-[#E04428]/30">
                  CODE-SWITCH STT
                </span>
              </div>
              <p className="font-mono-tech text-[11px] text-[#656057] hidden sm:block">
                MULTILINGUAL BROADCAST TRANSCRIPTION CONSOLE · HI / EN / 90+ LANGUAGES
              </p>
            </div>
          </div>

          {/* Live System Telemetry Badges */}
          <div className="flex flex-wrap items-center gap-2 font-mono-tech text-[11px] font-medium">
            {!health ? (
              <span className="px-2.5 py-1 rounded border border-[#D6CFC2] bg-[#F5F2EB] text-[#656057]">
                TELEMETRY: PROBING...
              </span>
            ) : health.offline ? (
              <span className="px-2.5 py-1 rounded border border-[#E04428] bg-[#E04428]/10 text-[#B92D14]">
                SERVER: OFFLINE
              </span>
            ) : (
              <>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border ${
                    health.db === 'connected'
                      ? 'bg-[#176B3A]/10 text-[#176B3A] border-[#176B3A]/35'
                      : 'bg-amber-500/15 text-amber-900 border-amber-500/40'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      health.db === 'connected' ? 'bg-[#176B3A]' : 'bg-amber-600'
                    }`}
                  />
                  {health.db === 'connected' ? 'NEON DB: ONLINE' : 'NEON DB: UNSET'}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border ${
                    health.geminiConfigured
                      ? 'bg-[#171614] text-[#FDFBF7] border-[#171614]'
                      : 'bg-[#E04428]/10 text-[#B92D14] border-[#E04428]/40'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      health.geminiConfigured ? 'bg-[#4ADE80]' : 'bg-[#E04428]'
                    }`}
                  />
                  {health.geminiConfigured
                    ? `ENGINE: ${health.model || 'gemini-3.8-live'}`
                    : 'GEMINI KEY: MISSING'}
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <LiveStudio
          onSaved={() => fetchTranscriptions(searchQuery)}
          onNotify={notify}
        />

        <HistoryDashboard
          transcriptions={transcriptions}
          loading={loading}
          error={historyError}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onRefresh={() => fetchTranscriptions(searchQuery)}
          onEdit={setEditingItem}
          onDelete={handleDelete}
          onNotify={notify}
        />
      </main>

      <EditModal
        item={editingItem}
        onClose={() => setEditingItem(null)}
        onSave={handleUpdate}
      />

      {/* Editorial Toast Notifications */}
      <div className="fixed bottom-5 right-5 z-50 space-y-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto px-4 py-2.5 rounded-md border shadow-[3px_3px_0px_#171614] font-mono-tech text-xs font-medium ${
              TOAST_PALETTE[t.type] || TOAST_PALETTE.info
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

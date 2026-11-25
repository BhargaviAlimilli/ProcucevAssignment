import { useCallback, useEffect, useState } from 'react';
import LiveStudio from './components/LiveStudio.jsx';
import HistoryDashboard from './components/HistoryDashboard.jsx';
import EditModal from './components/EditModal.jsx';

const TOAST_PALETTE = {
  info: 'bg-[#161A22] text-slate-100 border-white/15',
  success: 'bg-[#0D281E] text-emerald-200 border-emerald-500/40',
  error: 'bg-[#2A1016] text-rose-200 border-rose-500/40',
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
      notify('Transcription updated.', 'success');
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
      notify('Transcription deleted.', 'success');
      await fetchTranscriptions(searchQuery);
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Frosted Obsidian Header */}
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#090B0E]/85 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-400/10 border border-cyan-400/35 text-cyan-300 flex items-center justify-center shadow-[0_0_16px_rgba(34,211,238,0.18)]">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h3l2.5-6 3 12 2.5-8 2 4H21" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-white">
                  VaaniStream
                </h1>
                <span className="font-mono-lab text-[10px] font-medium px-2 py-0.5 rounded-full bg-cyan-400/10 text-cyan-300 border border-cyan-400/25">
                  AUDIO LAB
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Real-Time Multilingual Speech-to-Text · Code-Switching Studio
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono-lab text-[11px]">
            {!health ? (
              <span className="px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 text-slate-400">
                Checking...
              </span>
            ) : health.offline ? (
              <span className="px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-300">
                Server Offline
              </span>
            ) : (
              <>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${
                    health.db === 'connected'
                      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      health.db === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'
                    }`}
                  />
                  {health.db === 'connected' ? 'Neon DB' : 'DB Unset'}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${
                    health.geminiConfigured
                      ? 'bg-cyan-400/10 text-cyan-200 border-cyan-400/30'
                      : 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      health.geminiConfigured ? 'bg-cyan-400' : 'bg-rose-400'
                    }`}
                  />
                  {health.geminiConfigured ? health.model || 'gemini-3.8-live' : 'Key Missing'}
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

      {/* Toast Notifications */}
      <div className="fixed bottom-5 right-5 z-50 space-y-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto px-4 py-2.5 rounded-xl border shadow-2xl text-xs font-medium backdrop-blur-md ${
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

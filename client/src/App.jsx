import { useCallback, useEffect, useState } from 'react';
import LiveStudio from './components/LiveStudio.jsx';
import HistoryDashboard from './components/HistoryDashboard.jsx';
import EditModal from './components/EditModal.jsx';

const TOAST_PALETTE = {
  info: 'bg-slate-900 text-white',
  success: 'bg-emerald-600 text-white',
  error: 'bg-rose-600 text-white',
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
      notify('Transcription updated!', 'success');
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-900">
                VaaniStream
              </h1>
              <p className="text-xs text-slate-500 hidden sm:block">
                Real-Time Multilingual STT &amp; Code-Switching Dashboard
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium">
            {!health ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                <span className="w-2 h-2 rounded-full bg-slate-400" />
                Checking...
              </span>
            ) : health.offline ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700">
                Server Offline
              </span>
            ) : (
              <>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${
                    health.db === 'connected'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      health.db === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                  {health.db === 'connected' ? 'DB: Connected' : 'DB: Not Configured'}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${
                    health.geminiConfigured
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'bg-rose-50 text-rose-700'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      health.geminiConfigured ? 'bg-indigo-500' : 'bg-rose-500'
                    }`}
                  />
                  {health.geminiConfigured ? health.model || 'Gemini Live' : 'Gemini Key Missing'}
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
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
            className={`pointer-events-auto px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium ${
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

import { useEffect, useState } from 'react';

export default function EditModal({ item, onClose, onSave }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) {
      setTitle(item.title || '');
      setContent(item.content || '');
    }
  }, [item]);

  useEffect(() => {
    if (!item) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle || !trimmedContent) return;

    setSaving(true);
    try {
      await onSave(item.id, { title: trimmedTitle, content: trimmedContent });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="obsidian-panel rounded-2xl w-full max-w-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono-lab text-[11px] px-2 py-0.5 rounded bg-cyan-400/15 text-cyan-300 border border-cyan-400/30">
              #{String(item.id).padStart(3, '0')}
            </span>
            <h3 className="text-sm font-semibold text-white">Edit Transcription</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg leading-none cursor-pointer"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label
              htmlFor="editTitle"
              className="block font-mono-lab text-[11px] uppercase tracking-wider text-slate-400 mb-1.5"
            >
              Title
            </label>
            <input
              id="editTitle"
              type="text"
              required
              maxLength={255}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#0C0F14] px-3.5 py-2 text-sm text-white focus:outline-none focus:border-cyan-400/60"
            />
          </div>
          <div>
            <label
              htmlFor="editContent"
              className="block font-mono-lab text-[11px] uppercase tracking-wider text-slate-400 mb-1.5"
            >
              Transcript Content
            </label>
            <textarea
              id="editContent"
              rows={6}
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="transcript-font w-full rounded-xl border border-white/10 bg-[#0C0F14] px-3.5 py-2.5 text-sm leading-relaxed text-slate-100 focus:outline-none focus:border-cyan-400/60"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-[#090B0E] bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

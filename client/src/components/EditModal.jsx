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
      className="fixed inset-0 z-50 bg-[#171614]/60 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="editorial-card rounded-xl w-full max-w-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#D6CFC2] bg-[#FAF7F0] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono-tech text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#171614] text-[#FDFBF7]">
              #{String(item.id).padStart(3, '0')}
            </span>
            <h3 className="font-display text-sm font-bold uppercase tracking-wide text-[#171614]">
              Edit Archived Transcript
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="font-mono-tech text-base font-bold text-[#656057] hover:text-[#171614] cursor-pointer"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label
              htmlFor="editTitle"
              className="block font-mono-tech text-[11px] font-semibold uppercase tracking-wider text-[#656057] mb-1.5"
            >
              Tape Title
            </label>
            <input
              id="editTitle"
              type="text"
              required
              maxLength={255}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-[#C9C1B2] bg-white px-3 py-2 text-sm text-[#171614] focus:outline-none focus:border-[#171614]"
            />
          </div>
          <div>
            <label
              htmlFor="editContent"
              className="block font-mono-tech text-[11px] font-semibold uppercase tracking-wider text-[#656057] mb-1.5"
            >
              Script Content
            </label>
            <textarea
              id="editContent"
              rows={6}
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="transcript-font w-full rounded-md border border-[#C9C1B2] bg-white px-3 py-2 text-sm leading-relaxed text-[#171614] focus:outline-none focus:border-[#171614]"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="font-mono-tech text-xs font-semibold uppercase px-4 py-2 rounded-md border border-[#C9C1B2] bg-[#F5F2EB] text-[#171614] hover:bg-[#EAE4D7] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="tactile-btn font-display text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-md border border-[#171614] bg-[#171614] text-[#FDFBF7] shadow-[3px_3px_0px_#E04428] disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Updating...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

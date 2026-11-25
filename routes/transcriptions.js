import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

function ensurePool(res) {
  if (!pool) {
    res.status(503).json({
      error: 'Database is not configured. Please set DATABASE_URL in your environment.',
    });
    return false;
  }
  return true;
}

function parseId(rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

// GET /api/transcriptions?search=...
router.get('/', async (req, res) => {
  if (!ensurePool(res)) return;

  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    let result;
    if (search) {
      result = await pool.query(
        `SELECT id, title, content, language_mode, duration_seconds, created_at, updated_at
         FROM transcriptions
         WHERE title ILIKE $1 OR content ILIKE $1
         ORDER BY created_at DESC`,
        [`%${search}%`]
      );
    } else {
      result = await pool.query(
        `SELECT id, title, content, language_mode, duration_seconds, created_at, updated_at
         FROM transcriptions
         ORDER BY created_at DESC`
      );
    }

    res.json({ transcriptions: result.rows });
  } catch (err) {
    console.error('[API] GET /api/transcriptions error:', err);
    res.status(500).json({ error: 'Failed to fetch transcriptions.' });
  }
});

// POST /api/transcriptions
router.post('/', async (req, res) => {
  if (!ensurePool(res)) return;

  try {
    const {
      title,
      content,
      language_mode: languageMode,
      duration_seconds: durationSeconds,
    } = req.body ?? {};

    if (typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Transcription content is required.' });
    }

    const cleanTitle =
      typeof title === 'string' && title.trim().length > 0
        ? title.trim().slice(0, 255)
        : 'Untitled Transcript';

    const cleanLanguageMode =
      typeof languageMode === 'string' && languageMode.trim().length > 0
        ? languageMode.trim().slice(0, 100)
        : 'Auto (Multilingual)';

    const parsedDuration = Number(durationSeconds);
    const cleanDuration =
      Number.isFinite(parsedDuration) && parsedDuration >= 0
        ? Math.round(parsedDuration)
        : 0;

    const result = await pool.query(
      `INSERT INTO transcriptions (title, content, language_mode, duration_seconds)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, content, language_mode, duration_seconds, created_at, updated_at`,
      [cleanTitle, content.trim(), cleanLanguageMode, cleanDuration]
    );

    res.status(201).json({ transcription: result.rows[0] });
  } catch (err) {
    console.error('[API] POST /api/transcriptions error:', err);
    res.status(500).json({ error: 'Failed to save transcription.' });
  }
});

// PUT /api/transcriptions/:id
router.put('/:id', async (req, res) => {
  if (!ensurePool(res)) return;

  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'Invalid transcription ID.' });
  }

  try {
    const { title, content, language_mode: languageMode } = req.body ?? {};

    const updates = [];
    const values = [];

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: 'Title cannot be empty.' });
      }
      values.push(title.trim().slice(0, 255));
      updates.push(`title = $${values.length}`);
    }

    if (content !== undefined) {
      if (typeof content !== 'string' || content.trim().length === 0) {
        return res.status(400).json({ error: 'Content cannot be empty.' });
      }
      values.push(content.trim());
      updates.push(`content = $${values.length}`);
    }

    if (languageMode !== undefined) {
      if (typeof languageMode !== 'string' || languageMode.trim().length === 0) {
        return res.status(400).json({ error: 'Language mode cannot be empty.' });
      }
      values.push(languageMode.trim().slice(0, 100));
      updates.push(`language_mode = $${values.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        error: 'Provide at least one field (title, content, or language_mode) to update.',
      });
    }

    updates.push('updated_at = NOW()');
    values.push(id);

    const result = await pool.query(
      `UPDATE transcriptions
       SET ${updates.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, title, content, language_mode, duration_seconds, created_at, updated_at`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Transcription not found.' });
    }

    res.json({ transcription: result.rows[0] });
  } catch (err) {
    console.error('[API] PUT /api/transcriptions/:id error:', err);
    res.status(500).json({ error: 'Failed to update transcription.' });
  }
});

// DELETE /api/transcriptions/:id
router.delete('/:id', async (req, res) => {
  if (!ensurePool(res)) return;

  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'Invalid transcription ID.' });
  }

  try {
    const result = await pool.query(
      `DELETE FROM transcriptions WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Transcription not found.' });
    }

    res.json({ message: 'Transcription deleted.', id: result.rows[0].id });
  } catch (err) {
    console.error('[API] DELETE /api/transcriptions/:id error:', err);
    res.status(500).json({ error: 'Failed to delete transcription.' });
  }
});

export default router;

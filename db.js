import pg from 'pg';

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL?.trim();

const isLocalDatabase =
  !databaseUrl ||
  databaseUrl.includes('localhost') ||
  databaseUrl.includes('127.0.0.1');

export const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
    })
  : null;

if (pool) {
  pool.on('error', (err) => {
    console.error('[DB] Unexpected PostgreSQL idle client error:', err.message);
  });
}

/**
 * Ensures the transcriptions table exists on startup (auto-migration).
 * Skips gracefully with a warning if DATABASE_URL is not configured yet.
 */
export async function initDb() {
  if (!pool) {
    console.warn(
      '[DB] DATABASE_URL is not set. Database endpoints will return 503 until configured.'
    );
    return false;
  }

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS transcriptions (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL DEFAULT 'Untitled Transcript',
      content TEXT NOT NULL,
      language_mode VARCHAR(100) DEFAULT 'Auto (Multilingual)',
      duration_seconds INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at
      ON transcriptions (created_at DESC);
  `;

  await pool.query(createTableQuery);
  console.log('[DB] PostgreSQL connected and schema verified.');
  return true;
}

/**
 * Checks live PostgreSQL connectivity for health checks.
 */
export async function checkDbHealth() {
  if (!pool) {
    return { connected: false, reason: 'DATABASE_URL not configured' };
  }

  try {
    await pool.query('SELECT 1');
    return { connected: true };
  } catch (err) {
    return { connected: false, reason: err.message };
  }
}

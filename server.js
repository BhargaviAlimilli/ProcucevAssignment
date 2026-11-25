import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { initDb, checkDbHealth } from './db.js';
import transcriptionsRouter from './routes/transcriptions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (_req, res) => {
  const dbHealth = await checkDbHealth();
  res.json({
    status: 'ok',
    db: dbHealth.connected ? 'connected' : 'disconnected',
    ...(dbHealth.reason ? { dbError: dbHealth.reason } : {}),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    model: process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/transcriptions', transcriptionsRouter);

const server = http.createServer(app);

async function startServer() {
  try {
    await initDb();
  } catch (err) {
    console.error('[Startup] Database initialization warning:', err.message);
  }

  server.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
  });
}

startServer();

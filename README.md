# VaaniStream — Real-Time Multilingual Speech-to-Text & CRUD Dashboard

A full-stack, 100% free-tier web application for **real-time multilingual speech-to-text transcription** (with automatic mid-sentence code-switching such as **Hindi + English** and 90+ languages) paired with a searchable **PostgreSQL CRUD Transcription History Dashboard** and browser-native **Text-to-Speech (TTS)** playback.

---

## Architecture

```text
+-------------------------------------------------------------------+
|  Browser (React + Vite + Tailwind CSS, client/src/*)               |
|  - Mic Capture -> Web Audio API (16kHz, 16-bit mono PCM)          |
|  - Real-Time Transcript View (interim vs. committed text)         |
|  - CRUD Dashboard + Browser TTS (window.speechSynthesis)          |
+-------------------------------+-----------------------------------+
                                |
        HTTPS REST (/api/*)     |     WSS (/ws/transcribe)
                                v
+-------------------------------------------------------------------+
|  Node.js + Express + ws Server (server.js)                        |
|  - Serves built React bundle from client/dist (single origin)     |
|  - REST API: /api/health, /api/transcriptions (GET/POST/PUT/DEL)  |
|  - WebSocket Audio Bridge (services/geminiLive.js)                |
+----------------+-------------------------------+------------------+
                 |                               |
                 v                               v
+--------------------------------+   +------------------------------+
|  Gemini Live API               |   |  Neon Serverless PostgreSQL  |
|  (@google/genai)               |   |  (pg.Pool with SSL)          |
|  - gemini-3.8-live (fallback)  |   |  - Auto-migrates             |
|  - inputAudioTranscription     |   |    `transcriptions` table    |
|    (languageCodes: [])         |   |    on startup                |
+--------------------------------+   +------------------------------+
```

---

## Free-Tier Tech Stack

- **Frontend:** React 19, Vite, Tailwind CSS (`client/`), built into `client/dist/`
- **Runtime & Backend:** Node.js (v20+), Express, `ws`, `pg`, `dotenv`, `cors`
- **Real-Time Multilingual STT:** `@google/genai` connecting to the **Gemini Live API** (`gemini-3.8-live` with configurable fallback via `GEMINI_LIVE_MODEL`) using `inputAudioTranscription: { languageCodes: [] }`
- **Database:** **Neon** (`neon.tech`) permanent free-tier serverless PostgreSQL (0.5 GB, no credit card)
- **Hosting:** **Render** (`render.com`) Free Web Service with persistent `wss://` WebSocket support
- **Text-to-Speech:** Browser-native **Web Speech API (`window.speechSynthesis`)** supporting `hi-IN`, `en-IN`, and `en-US` with zero extra API keys

---

## Free-Tier Cloud Setup Guide

### 1. Google AI Studio (`GEMINI_API_KEY`)
1. Visit [Google AI Studio](https://aistudio.google.com/) and sign in with a Google account.
2. Go to **Get API key** -> **Create API key**.
3. Copy the generated key for your `.env` / Render environment variables (`GEMINI_API_KEY`).

### 2. Neon Serverless PostgreSQL (`DATABASE_URL`)
1. Sign up for a free account at [Neon](https://neon.tech/) (no credit card required).
2. Create a new project (e.g., `vaanistream-db`).
3. From the Neon dashboard **Connection Details**, copy the PostgreSQL connection string (`postgresql://...sslmode=require`).
4. Paste it into `DATABASE_URL`. On server startup, `db.js` automatically runs `CREATE TABLE IF NOT EXISTS transcriptions (...)`—no manual SQL migration is required.

### 3. Local Development
```bash
# 1. Install root + client dependencies and build the React frontend
npm install
npm run build

# 2. Configure environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL and GEMINI_API_KEY

# 3. Start the production-like server (serves client/dist + API + WS on :3000)
npm start

# Or run backend + Vite HMR dev server separately in two terminals:
npm run dev
npm run dev:client
```
Open `http://localhost:3000` (production build) or `http://localhost:5173` (Vite dev server with `/api` & `/ws` proxy) in Chrome or Edge and allow microphone access.

### 4. Deploy to Render (`render.yaml`)
1. Push this repository to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com/), click **New +** -> **Blueprint** (or **Web Service**).
3. Select your repository—Render detects `render.yaml` (`buildCommand: npm install && npm run build`, `startCommand: npm start`, `healthCheckPath: /api/health`).
4. Set the secret environment variables in Render:
   - `DATABASE_URL` (your Neon connection string)
   - `GEMINI_API_KEY` (your Google AI Studio API key)
   - `GEMINI_LIVE_MODEL` (`gemini-3.8-live`, optional override)
5. Deploy! HTTP and `wss://` WebSockets share the same origin (`https://<your-app>.onrender.com`).

> **Note on Render Free Tier Cold Starts:** Render's free web service spins down after 15 minutes of inactivity. The first request after an idle period may take **~50 seconds** while the container wakes up. Active WebSocket audio streams keep the connection alive while in use.

---

## API & WebSocket Reference

### REST Endpoints
- `GET /api/health` — Returns server status, PostgreSQL connection state, and active Gemini Live model configuration.
- `GET /api/transcriptions?search=` — Lists saved transcriptions ordered by `created_at DESC`, with optional case-insensitive filtering on `title` and `content`.
- `POST /api/transcriptions` — Creates a transcription (`title`, `content`, `language_mode`, `duration_seconds`).
- `PUT /api/transcriptions/:id` — Updates `title`, `content`, and/or `language_mode`, refreshing `updated_at`.
- `DELETE /api/transcriptions/:id` — Deletes a transcription by `id`.

### WebSocket Endpoint (`/ws/transcribe`)
- **Client -> Server:**
  - Optional JSON control messages: `{"type":"start","languageCodes":[]}` and `{"type":"stop"}`
  - Binary PCM frames: `16000 Hz`, `1` channel (mono), `16-bit signed integer little-endian`
- **Server -> Client:**
  - `{"type":"status","status":"connecting"|"ready"|"stopped"|"closed","model":"..."}`
  - `{"type":"transcript","text":"...","isFinal":true|false}`
  - `{"type":"turn_complete"}`
  - `{"type":"error","message":"..."}`

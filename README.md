# VaaniStream — Real-Time Multilingual Speech-to-Text & CRUD Dashboard

A full-stack, 100% free-tier web application for **real-time multilingual speech-to-text transcription** (supporting automatic mid-sentence code-switching such as **Hindi + English** and 90+ languages) paired with a searchable **PostgreSQL CRUD Transcription Vault** and browser-native **Text-to-Speech (TTS)** playback.

- **Live Deployed App:** https://vaanistream-multilingual-stt.onrender.com
- **Live Health Check:** https://vaanistream-multilingual-stt.onrender.com/api/health

---

## Important Note for Evaluators: Free-Tier Hosting & API Limitations

This deployment runs entirely on **100% free-tier cloud services**. Please keep the following expected free-tier behaviors in mind while testing:

1. **Render Free Web Service Cold Starts (~50–60s):**
   - Render automatically spins down free-tier web services after **15 minutes of inactivity**.
   - The very first request after an idle period takes **~50–60 seconds** while the container wakes up (a first page load may briefly stall or show a loading spinner). Simply wait ~1 minute and refresh `/api/health` or `/`.
   - Resource limits: 512 MB RAM, shared CPU, and 750 free instance hours/month. Very long idle WebSocket connections may be recycled by Render.
2. **Gemini API Free Tier Rate & Concurrency Limits:**
   - Real-time STT uses a Google AI Studio **free-tier** `GEMINI_API_KEY` (`gemini-3.8-live`, with automatic fallback to `gemini-3.5-transcribe-live` and `gemini-3.1-flash-live-preview`).
   - Free-tier keys enforce per-minute token/request caps (**~25 audio tokens/sec** while streaming), daily quotas (resetting at midnight Pacific Time), and a small limit on concurrent Live WebSocket sessions.
   - **Tips while evaluating:** Avoid recording in multiple browser tabs at the same time, and click **Stop Microphone** once finished speaking. If you encounter a temporary rate-limit (`429`) message, wait ~60 seconds before starting another mic session.
3. **Neon Free-Tier Serverless PostgreSQL:**
   - Neon's free 0.5 GB database auto-suspends compute after inactivity; the first database query after an idle stretch may take **1–2 seconds** to wake up.
4. **Browser Microphone & TTS Requirements:**
   - Open the live `https://` URL in **Chrome** or **Edge** and allow microphone permission when prompted.
   - **Listen (TTS)** uses the browser-native `window.speechSynthesis` API (`hi-IN`, `en-IN`, `en-US`); available voices depend on your OS/browser voice packs.

---

## Evaluator Testing Guide (Step-by-Step)

### Step 1: Wake Up the Server & Check Health
1. Open **https://vaanistream-multilingual-stt.onrender.com/api/health** (allow ~50s if the Render free instance was asleep).
2. Confirm HTTP `200` with:
   ```json
   {
     "status": "ok",
     "db": "connected",
     "geminiConfigured": true,
     "model": "gemini-3.8-live"
   }
   ```

### Step 2: Verify Dashboard Telemetry
1. Open **https://vaanistream-multilingual-stt.onrender.com/**.
2. In the top-right header, verify both status pills show green/cyan active indicators:
   - **`Neon DB`**
   - **`gemini-3.8-live`**

### Step 3: Test Real-Time Multilingual & Code-Switching STT
1. In **Live Audio Stage** (left panel), choose a **Language Detection** mode (default **`Auto`** works best for mid-sentence code-switching; **`HI + EN`**, **`Hindi`**, **`EN-IN`**, and **`EN-US`** provide optional hints).
2. Click **`Start Microphone`** and grant microphone permission in Chrome/Edge.
3. Wait for the status pill to switch to **`Live · gemini-3.8-live`** and confirm the live canvas oscilloscope responds to your voice.
4. Speak naturally—including mid-sentence Hindi + English code-switching (for example: *"Hello team, aaj ki meeting ka main agenda deploy verification hai"*).
5. Observe:
   - Interim words appear highlighted in cyan as you speak and commit cleanly as sentences finish.
   - The script badge updates automatically (`BILINGUAL · HI + EN`, `DEVANAGARI · HI`, or `LATIN · EN`).
6. Click **`Stop Microphone`** when finished.

### Step 4: Test Database Persistence, Search, CRUD & TTS Playback
*(Note: You can also test this entire step **without** using the microphone or Gemini quota by clicking **`Edit`** in **Live Output** and typing sample text manually.)*

1. Enter a **Session Title** (e.g., `Hinglish Demo Clip`).
2. Click **`Save to Database`** — the new entry immediately appears at the top of **Transcription Vault** (right panel).
3. **Persistence Check:** Refresh the browser page (`F5`) and confirm the saved record reloads from Neon PostgreSQL.
4. **Search:** Type a keyword (English or Devanagari) into **`Filter by title, Hindi, or English text...`** to verify `?search=` filtering.
5. **TTS Playback:** Select **`hi-IN`**, **`en-IN`**, or **`en-US`** under **TTS Voice**, click **`Listen`** on any card, and click **`Stop`** to halt playback.
6. **Copy / Edit / Delete:**
   - Click **`Copy`** to copy transcript text (`Copied` confirmation).
   - Click **`Edit`** to update the title or transcript content in the modal and click **`Save Changes`**.
   - Click **`Delete`** -> **`Confirm`** to permanently remove the record.

### Step 5: Optional REST API Verification (`curl`)
```bash
# 1. Health check
curl https://vaanistream-multilingual-stt.onrender.com/api/health

# 2. Create a transcription
curl -X POST https://vaanistream-multilingual-stt.onrender.com/api/transcriptions \
  -H "Content-Type: application/json" \
  -d '{"title":"API Test","content":"Hello नमस्ते code-switch check","language_mode":"Auto (Multilingual)","duration_seconds":12}'

# 3. List & search transcriptions
curl "https://vaanistream-multilingual-stt.onrender.com/api/transcriptions?search=API%20Test"

# 4. Update by ID (replace <ID>)
curl -X PUT https://vaanistream-multilingual-stt.onrender.com/api/transcriptions/<ID> \
  -H "Content-Type: application/json" \
  -d '{"title":"API Test Updated"}'

# 5. Delete by ID (replace <ID>)
curl -X DELETE https://vaanistream-multilingual-stt.onrender.com/api/transcriptions/<ID>
```

---

## Architecture

```text
+-------------------------------------------------------------------+
|  Browser (React 19 + Vite + Tailwind CSS, client/src/*)           |
|  - Mic Capture -> Web Audio API (AudioWorklet -> 16kHz PCM16)     |
|  - Real-Time Canvas Oscilloscope & Interim/Committed Captions     |
|  - CRUD Vault + Browser TTS (window.speechSynthesis)              |
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
|  - gemini-3.8-live (+fallbacks)|   |  - Auto-migrates             |
|  - inputAudioTranscription: {} |   |    `transcriptions` table    |
|  - Language hints in sysPrompt |   |    on server startup         |
+--------------------------------+   +------------------------------+
```

---

## Tech Stack

- **Frontend:** React 19, Vite 6, Tailwind CSS v4 (`client/`), compiled into `client/dist/` and served on the same origin as the backend.
- **Runtime & Backend:** Node.js (v20+), Express, `ws`, `pg`, `dotenv`, `cors`.
- **Real-Time Multilingual STT:** `@google/genai` connecting to the Gemini Live API (`gemini-3.8-live`, with fallbacks `gemini-3.5-transcribe-live` and `gemini-3.1-flash-live-preview` configurable via `GEMINI_LIVE_MODEL` / `GEMINI_LIVE_FALLBACK_MODELS`). Uses `inputAudioTranscription: {}` for automatic multilingual detection and mid-sentence code-switching, with optional language hints passed via `systemInstruction`.
- **Database:** Neon free-tier serverless PostgreSQL (`pg.Pool` with SSL enabled for cloud connections and auto-migration via `CREATE TABLE IF NOT EXISTS transcriptions` on startup in `db.js`).
- **Hosting:** Render Free Web Service (`render.yaml`) supporting HTTPS and persistent `wss://` WebSockets on a single port (`process.env.PORT || 3000`).
- **Text-to-Speech:** Browser-native Web Speech API (`window.speechSynthesis`) supporting `hi-IN`, `en-IN`, and `en-US` with zero extra API keys.

---

## Local Development & Deployment Setup

### 1. Local Setup
```bash
# 1. Install root + client dependencies and build the React frontend
npm install
npm run build

# 2. Configure environment variables
cp .env.example .env
# Edit .env with your Neon DATABASE_URL and Google AI Studio GEMINI_API_KEY

# 3. Start production-mode server (serves client/dist + API + WS on :3000)
npm start

# Or run backend + Vite HMR dev server separately in two terminals:
npm run dev
npm run dev:client
```
Open `http://localhost:3000` (production build) or `http://localhost:5173` (Vite dev server with `/api` and `/ws` proxy).

### 2. Render Blueprint Deployment (`render.yaml`)
1. Push this repository to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com/), click **New + -> Blueprint**.
3. Select the repository — `render.yaml` configures `buildCommand: npm install && npm run build`, `startCommand: npm start`, and `healthCheckPath: /api/health`.
4. Provide `DATABASE_URL` (Neon connection string) and `GEMINI_API_KEY` (Google AI Studio key).

---

## API & WebSocket Contract

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

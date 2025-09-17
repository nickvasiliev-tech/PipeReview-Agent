
# Deal Inspection App (Record → Upload → Analyze)

A production-ready package to record **long** deal reviews without artificial time limits, upload in chunks to the server, and (optionally) run transcript + analysis if you provide API keys.

## Features
- **No time limit**: client records in small chunks (default 5s) and uploads continuously.
- **Resumable session**: each capture has a `sessionId`; chunks are stored and concatenated server-side with **FFmpeg**.
- **Ready for Render.com**: simple Node service, single Start Command.
- **Index.html included**: open `/` to use the app immediately.
- **Optional** integrations (off by default):
  - Whisper transcription (requires `OPENAI_API_KEY` and enabling the route).
  - GPT analysis to produce an executive summary and next steps (same key).

## Quick Start (Local)
1. Install Node 20+:
   ```bash
   node -v
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. (Optional) Create `.env` in the project root:
   ```env
   PORT=8080
   STORAGE_DIR=./data
   MAX_CHUNK_BYTES=104857600
   # Optional OpenAI
   OPENAI_API_KEY=sk-...
   ENABLE_TRANSCRIBE=false
   ENABLE_ANALYZE=false
   ```
4. Run:
   ```bash
   npm start
   ```
5. Open http://localhost:8080

## Deploy to Render
- **Service type**: Web Service.
- **Runtime**: Node.
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Instance type**: pick according to expected load.
- **Persistent storage**: add a **Disk** and mount it to `/data` (or set `STORAGE_DIR`).
- Set env vars in the Render dashboard (see `.env` keys above).

## API
- `POST /api/chunk` — multipart form with fields:
  - `sessionId` (string)
  - `chunkIndex` (number)
  - `totalChunks` (optional number)
  - `meta` (optional JSON string with deal fields)
  - `audio` (file blob - webm/opus)
- `POST /api/finalize` — body: `{ sessionId }` → returns `{ ok, fileUrl }`
- `POST /api/transcribe` *(optional)* — body: `{ sessionId }` → returns `{ text }`
- `POST /api/analyze` *(optional)* — body: `{ transcript, meta }` → returns `{ summary, risks, actions }`

## Notes
- Concatenation uses FFmpeg via `fluent-ffmpeg` and `@ffmpeg-installer/ffmpeg`.
- Output is `.mp3` for broad compatibility.
- If you don't enable optional routes, the app still records and stores audio + metadata JSON.

## Folder Layout
```
.
├─ client/
│  ├─ public/
│  │  └─ index.html
│  └─ src/
│     └─ app.js
├─ server/
│  └─ server.js
├─ package.json
├─ .env.example
├─ Dockerfile
└─ README.md
```

## Security
- CORS defaults to same-origin; adjust as needed.
- Max chunk size is configurable via `MAX_CHUNK_BYTES`.


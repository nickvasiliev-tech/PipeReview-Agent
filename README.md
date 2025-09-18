# Deal Inspection App

Records and analyzes sales deal review sessions. Supports:
- **Option A**: Mic-only capture
- **Option B**: Teams web tab + mic (Chrome/Edge) — pick the Teams tab and enable **Also share tab audio**

EN/RU transcription with auto-detect; all outputs are in English. Multiple deals per session. Exports to JSON/CSV/Markdown.

## Quick Start (Local)

```bash
npm install
cp backend/.env.example backend/.env
# add your OPENAI_API_KEY to backend/.env
npm start
# open http://localhost:3000
```

## Deploy (GitHub → Render)

1. Push this repository to GitHub.
2. Create a new **Web Service** on Render:
   - Build command: `npm install`
   - Start command: `npm start`
   - Root Directory: (repo root)
   - Environment: add `OPENAI_API_KEY`
3. Health check path: `/healthz`

## Tech

- Frontend: Vanilla JS + HTML + Tailwind (index.html included)
- Backend: Node.js + Express
- Endpoints:
  - `POST /api/transcribe` — multipart/form-data, field `audio`
  - `POST /api/extract` — JSON `{ transcript_en }`
- Ephemeral audio: processed in-memory (no disk saves)
- Browser support: Chrome/Edge (primary); Firefox mic-only; Safari limited
- 1-hour sessions supported (MediaRecorder chunking)

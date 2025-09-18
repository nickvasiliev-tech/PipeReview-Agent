# Deal Inspection App (Option B: Teams Tab + Mic)

Deployment-ready Node.js app that records meetings in the browser, supports **Option B (Teams tab audio + mic mix)**, and sends audio for transcription and deal extraction. Input can be **English or Russian**; all outputs are **English**.

## Features
- **Option A**: Mic-only capture
- **Option B**: **Teams (web) tab audio + mic** capture (Windows + Chrome/Edge recommended)
- Upload existing files (webm/mp3/m4a/wav/ogg/mp4)
- Transcribe via OpenAI **gpt-4o-mini-transcribe** (or model of your choice)
- Force-English normalization and deal extraction
- No persistent audio storage by default

## Quick Start

```bash
# 1) Clone and install
npm install

# 2) Configure environment
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-...

# 3) Run locally
npm run start
# → http://localhost:3000
```

## Render Deployment

1. Push to GitHub.
2. Create a new **Web Service** in Render using this repo.
3. Set **Build Command**: `npm install`
4. Set **Start Command**: `npm start`
5. Add **Environment Variables**:
   - `OPENAI_API_KEY` — your key
   - (optional) `AUDIO_MODEL=gpt-4o-mini-transcribe`
   - (optional) `TEXT_MODEL=gpt-4.1-mini`
   - (optional) `FORCE_ENGLISH=true`
6. Open the URL Render provides.

## Option B Notes
- Click **Initialize** in the app, then in the browser dialog choose the **Teams web tab** and toggle **“Also share tab audio.”**
- **Windows + Chrome/Edge**: best results.
- **macOS**: system audio capture may need extra OS permissions or be limited.
- **Teams desktop app**: tab capture doesn’t work; on Windows, share **entire screen with system audio** or use a virtual audio device.

## API
- `POST /api/transcribe` — multipart form field `audio` (≤ 25 MB). Returns `{ transcript, language, model }`. If no `OPENAI_API_KEY`, returns a stub.
- `POST /api/extract` — `{ text }` → returns `{ deals: [...] }` using LLM, or a heuristic placeholder without a key.

## Tech
- Frontend: vanilla HTML/CSS/JS (minimal dependencies) with **index.html**.
- Backend: Node.js + Express, Multer for uploads, **OpenAI API** for STT + extraction.
- CORS enabled for flexibility.

## Security & Privacy
- HTTPS recommended in production.
- Audio kept in memory only; not saved to disk.
- Set Render service to auto-deploy on `main` (optional).

## Troubleshooting
- **Start button disabled** → microphone or display capture permission not granted.
- **Only local mic recorded** → ensure you selected the **Teams tab** and toggled **Share tab audio**.
- **Transcription empty** → check `OPENAI_API_KEY` and model name.

## License
MIT

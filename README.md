
# AI Deals Recorder v1.2.1 (Web)

Record mic or system audio (via screen share), transcribe RU/EN, and parse deals with OpenAI. Exports CSV/Markdown.

## Quick start
1) Install Node.js 18+ (LTS).  
2) Unzip. Create `.env` from `.env.example` and add your OPENAI_API_KEY.  
3) `npm install`  
4) `npm start`  
5) Open http://localhost:3000

## .env example
```
OPENAI_API_KEY=sk-REPLACE_ME
OPENAI_MODEL=gpt-4o
OPENAI_TRANSCRIBE_MODEL=whisper-1
TZ=Europe/Madrid
PORT=3000
```

## Troubleshooting "Transcription failed"
- Check server console logs — now includes model-specific errors.
- Try: `OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe` (or `gpt-4o-transcribe`).
- For system audio in Chrome/Edge on Windows: **share Entire screen + Share system audio**.
- Test Mic mode first to confirm audio capture.


---

## v1.2.2 — Logging & Connection-error hardening
- **Request logging** with timings in server console.
- **Retries + timeouts** around OpenAI calls (`OPENAI_TIMEOUT_MS`, default 60000).
- `GET /api/health` and `GET /api/debug` endpoints.
- If you see "Connection error":
  1. Check terminal logs for `[Retry ...]` messages.
  2. Ensure internet connectivity and firewall allows outbound to OpenAI.
  3. Try increasing timeout in `.env`:
     ```env
     OPENAI_TIMEOUT_MS=90000
     ```
  4. Verify your API key/quota at OpenAI dashboard.


---

## v1.2.3 — Proxy support & manual fallback
- Respects `HTTPS_PROXY` via undici ProxyAgent (global).
- `/api/connectivity` probes OpenAI reachability.
- Manual fallback in UI: paste transcript text → parse via GPT (bypasses STT).
- Richer error payloads include proxy info.

### Behind a corporate proxy / firewall
Set in `.env` (or system env):
```
HTTPS_PROXY=http://user:pass@proxy.example.com:3128
OPENAI_TIMEOUT_MS=90000
```
Then restart `npm start` and check `GET /api/connectivity`.


---

## v1.2.4 — .env override & env diagnostics
- Forces `.env` to **override** system environment variables.
- Prints masked API key at startup and exposes `GET /api/env` (masked) for quick checks.
- Helper script: `node check-env.js` shows which key Node actually sees.

### If your key looks like `sk-sk-...`
Likely a system/user environment variable concatenated with the `.env` value (e.g., set via `setx`).
Fix:
- **Windows PowerShell (session only)**: `Remove-Item Env:OPENAI_API_KEY`
- **Windows (persistent)**: System Properties → Environment Variables → delete `OPENAI_API_KEY` from *User* and *System*.
- **macOS/Linux (session only)**: `unset OPENAI_API_KEY`
Then rely solely on `.env` (restart terminal after changes).

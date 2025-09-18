# Deal Inspection App — Multi‑Deal (Markers)

Record one continuous session and tag **multiple deals** with start/end markers. On **Finalize**, the server produces:
- a **full-session MP3**, and
- **separate MP3s per deal**, named using your deal titles.

## What’s new vs the single‑deal version
- **Start Deal**/**End Deal** buttons to create timestamped markers.
- A **Deals panel** showing active and completed deals with time ranges.
- Server splits the final audio into **one file per deal** and writes `deals.json` with metadata.

## Quick Start (Local)
```bash
npm install
npm start
# open http://localhost:8080
```

Optional `.env`:
```env
PORT=8080
STORAGE_DIR=./data
MAX_CHUNK_BYTES=104857600
# Optional analysis (placeholders off by default)
OPENAI_API_KEY=
ENABLE_TRANSCRIBE=false
ENABLE_ANALYZE=false
```

## Deploy to Render
- **Build:** `npm install`
- **Start:** `npm start`
- **Disk:** mount a persistent disk at `/data` or set `STORAGE_DIR`.
- **Runtime:** Node 20+

## API
- `POST /api/chunk` — Upload 5–10s audio chunks.
- `POST /api/finalize` — Body: `{ sessionId, markers: [...], totalDurationMs }` → returns:
  ```json
  {
    "ok": true,
    "fileUrl": "/final/<sessionId>.mp3",
    "deals": [
      {
        "index": 0,
        "name": "ACME · Ootbi 48TB",
        "fileUrl": "/final/<sessionId>/deal-0-ACME-Ootbi-48TB.mp3",
        "startMs": 0,
        "endMs": 1800000
      }
    ]
  }
  ```

## Notes
- Markers can overlap (not typical) — each becomes its own slice.
- If no markers were added, the server creates a **single default deal** from 0 → end.
- Concatenation and slicing use FFmpeg (`fluent-ffmpeg`).

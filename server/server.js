/* Deal Inspection App server (Multi‑Deal) */
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const ffmpeg = require("@ffmpeg-installer/ffmpeg");
const ff = require("fluent-ffmpeg");
ff.setFfmpegPath(ffmpeg.path);

require("dotenv").config();

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(cors());

const PORT = process.env.PORT || 8080;
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(process.cwd(), "data");
const PUBLIC_DIR = path.join(process.cwd(), "client", "public");
const MAX_CHUNK_BYTES = Number(process.env.MAX_CHUNK_BYTES || 100 * 1024 * 1024);

fs.mkdirSync(STORAGE_DIR, { recursive: true });
fs.mkdirSync(path.join(STORAGE_DIR, "sessions"), { recursive: true });
fs.mkdirSync(path.join(STORAGE_DIR, "final"), { recursive: true });

app.use("/", express.static(PUBLIC_DIR));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CHUNK_BYTES },
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// CHUNK UPLOAD
app.post("/api/chunk", upload.single("audio"), async (req, res) => {
  try {
    const { sessionId, chunkIndex, meta } = req.body;
    if (!sessionId || chunkIndex === undefined) {
      return res.status(400).json({ ok: false, error: "Missing sessionId or chunkIndex" });
    }
    if (!req.file) return res.status(400).json({ ok: false, error: "Missing audio file" });

    const sessionDir = path.join(STORAGE_DIR, "sessions", sessionId);
    await fsp.mkdir(sessionDir, { recursive: true });

    // Persist meta snapshot (optional)
    if (meta) {
      try {
        const m = JSON.parse(meta);
        await fsp.writeFile(path.join(sessionDir, "meta.last.json"), JSON.stringify(m, null, 2));
      } catch {}
    }

    const chunkPath = path.join(sessionDir, `${String(chunkIndex).padStart(6, "0")}.webm`);
    await fsp.writeFile(chunkPath, req.file.buffer);
    return res.json({ ok: true, received: Number(chunkIndex) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Chunk save failed" });
  }
});

function sanitizeName(s) {
  return String(s || "deal")
    .replace(/[\/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

// FINALIZE
app.post("/api/finalize", async (req, res) => {
  try {
    const { sessionId, markers, totalDurationMs } = req.body;
    if (!sessionId) return res.status(400).json({ ok: false, error: "Missing sessionId" });

    const sessionDir = path.join(STORAGE_DIR, "sessions", sessionId);
    const finalDir = path.join(STORAGE_DIR, "final", sessionId);
    const finalRoot = path.join(STORAGE_DIR, "final");
    await fsp.mkdir(finalDir, { recursive: true });

    const files = (await fsp.readdir(sessionDir)).filter(f => f.endsWith(".webm")).sort();
    if (files.length === 0) return res.status(400).json({ ok: false, error: "No chunks found" });

    const listPath = path.join(sessionDir, "list.txt");
    const listContent = files.map(f => `file '${path.join(sessionDir, f).replace(/'/g, "'\\''")}'`).join("\n");
    await fsp.writeFile(listPath, listContent);

    const sessionOutName = `${sessionId}.mp3`;
    const sessionOutPath = path.join(finalRoot, sessionOutName);

    await new Promise((resolve, reject) => {
      ff()
        .input(listPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions(["-c:a", "libmp3lame", "-q:a", "2"])
        .on("error", reject)
        .on("end", resolve)
        .save(sessionOutPath);
    });

    // Normalize markers
    let mks = Array.isArray(markers) ? markers : [];
    const durationMs = Number(totalDurationMs || 0);
    if (mks.length === 0) {
      mks = [{
        name: "Session",
        index: 0,
        startMs: 0,
        endMs: durationMs || null,
        meta: {}
      }];
    } else {
      mks = mks
        .map((m, i) => ({
          index: i,
          name: String(m.name || `Deal ${i+1}`),
          startMs: Math.max(0, Number(m.startMs || 0)),
          endMs: m.endMs != null ? Math.max(0, Number(m.endMs)) : null,
          meta: m.meta || {}
        }))
        .sort((a,b) => a.startMs - b.startMs);
      for (let i=0;i<mks.length;i++) {
        if (mks[i].endMs == null) {
          mks[i].endMs = (i < mks.length - 1) ? mks[i+1].startMs : (durationMs || mks[i].startMs);
        }
      }
    }

    await fsp.writeFile(path.join(finalDir, "deals.json"), JSON.stringify(mks, null, 2));

    const dealsOut = [];
    for (const d of mks) {
      const ss = (d.startMs || 0) / 1000;
      const ee = (d.endMs || 0) / 1000;
      const dur = Math.max(0, ee - ss);
      const safeName = sanitizeName(d.name);
      const outName = `deal-${d.index}-${safeName}.mp3`;
      const outPath = path.join(finalDir, outName);

      await new Promise((resolve, reject) => {
        ff()
          .input(sessionOutPath)
          .outputOptions([ "-ss", String(ss), "-t", String(dur), "-c:a", "libmp3lame", "-q:a", "2" ])
          .on("error", reject)
          .on("end", resolve)
          .save(outPath);
      });

      dealsOut.push({
        index: d.index,
        name: d.name,
        startMs: d.startMs,
        endMs: d.endMs,
        fileUrl: `/final/${sessionId}/${outName}`,
        meta: d.meta || {}
      });
    }

    return res.json({ ok: true, fileUrl: `/final/${sessionOutName}`, deals: dealsOut });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Finalize failed" });
  }
});

app.use("/final", express.static(path.join(STORAGE_DIR, "final"), { maxAge: "365d", immutable: true }));

const ENABLE_TRANSCRIBE = String(process.env.ENABLE_TRANSCRIBE || "false").toLowerCase() === "true";
const ENABLE_ANALYZE = String(process.env.ENABLE_ANALYZE || "false").toLowerCase() === "true";

if (ENABLE_TRANSCRIBE || ENABLE_ANALYZE) {
  app.post("/api/transcribe", async (req, res) => {
    if (!ENABLE_TRANSCRIBE) return res.status(404).json({ ok: false, error: "Disabled" });
    return res.json({ ok: true, text: "(Transcription placeholder.)" });
  });
  app.post("/api/analyze", async (req, res) => {
    if (!ENABLE_ANALYZE) return res.status(404).json({ ok: false, error: "Disabled" });
    const { transcript, meta } = req.body || {};
    const summary = {
      deal: meta || {},
      highpoints: ["Pain clear", "Budget owner identified", "Next step dated"],
      risks: ["Need multi-threading", "Security review unclear"],
      actions: ["Exec alignment", "Confirm DPIA/DPA", "Lock legal timeline"]
    };
    return res.json({ ok: true, summary, risks: summary.risks, actions: summary.actions });
  });
}

app.get("*", (_req, res) => { res.sendFile(path.join(PUBLIC_DIR, "index.html")); });

app.listen(PORT, () => console.log(`Multi‑Deal server on :${PORT}`));

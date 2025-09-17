
/* Deal Inspection App server (Express) */
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const ffmpeg = require("@ffmpeg-installer/ffmpeg");
const ff = require("fluent-ffmpeg");
ff.setFfmpegPath(ffmpeg.path);

require("dotenv").config();

const app = express();
app.use(express.json({ limit: "5mb" }));

// CORS: lock down as needed
app.use(cors());

const PORT = process.env.PORT || 8080;
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(process.cwd(), "data");
const PUBLIC_DIR = path.join(process.cwd(), "client", "public");
const MAX_CHUNK_BYTES = Number(process.env.MAX_CHUNK_BYTES || 100 * 1024 * 1024); // 100 MB

// Ensure storage dir
fs.mkdirSync(STORAGE_DIR, { recursive: true });
fs.mkdirSync(path.join(STORAGE_DIR, "sessions"), { recursive: true });
fs.mkdirSync(path.join(STORAGE_DIR, "final"), { recursive: true });

// Static frontend
app.use("/", express.static(PUBLIC_DIR));

// Multer storage to memory; we stream to disk ourselves to enforce limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CHUNK_BYTES },
});

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

// Receive chunk
app.post("/api/chunk", upload.single("audio"), async (req, res) => {
  try {
    const { sessionId, chunkIndex, totalChunks, meta } = req.body;
    if (!sessionId || chunkIndex === undefined) {
      return res.status(400).json({ ok: false, error: "Missing sessionId or chunkIndex" });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Missing audio file" });
    }
    const sessionDir = path.join(STORAGE_DIR, "sessions", sessionId);
    await fsp.mkdir(sessionDir, { recursive: true });

    // Persist meta once (or update)
    if (meta) {
      try {
        const m = JSON.parse(meta);
        await fsp.writeFile(path.join(sessionDir, "meta.json"), JSON.stringify(m, null, 2));
      } catch (_) {}
    }

    const chunkPath = path.join(sessionDir, `${String(chunkIndex).padStart(6, "0")}.webm`);
    await fsp.writeFile(chunkPath, req.file.buffer);

    return res.json({ ok: true, received: Number(chunkIndex), totalChunks: totalChunks ? Number(totalChunks) : null });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Chunk save failed" });
  }
});

// Finalize: concatenate with ffmpeg -> mp3
app.post("/api/finalize", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ ok: false, error: "Missing sessionId" });
    const sessionDir = path.join(STORAGE_DIR, "sessions", sessionId);
    const finalDir = path.join(STORAGE_DIR, "final");
    await fsp.mkdir(finalDir, { recursive: true });

    const files = (await fsp.readdir(sessionDir))
      .filter(f => f.endsWith(".webm"))
      .sort();

    if (files.length === 0) return res.status(400).json({ ok: false, error: "No chunks found" });

    // Create ffmpeg concat list
    const listPath = path.join(sessionDir, "list.txt");
    const listContent = files.map(f => `file '${path.join(sessionDir, f).replace(/'/g,"'\\''")}'`).join("\n");
    await fsp.writeFile(listPath, listContent);

    const outName = `${sessionId}.mp3`;
    const outPath = path.join(finalDir, outName);

    await new Promise((resolve, reject) => {
      ff()
        .input(listPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions(["-c:a", "libmp3lame", "-q:a", "2"])
        .on("error", reject)
        .on("end", resolve)
        .save(outPath);
    });

    const fileUrl = `/final/${outName}`;
    return res.json({ ok: true, fileUrl });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Finalize failed" });
  }
});

// Serve final files
app.use("/final", express.static(path.join(STORAGE_DIR, "final"), { maxAge: "365d", immutable: true }));

// (Optional) Transcription and analysis — disabled by default
const ENABLE_TRANSCRIBE = String(process.env.ENABLE_TRANSCRIBE || "false").toLowerCase() === "true";
const ENABLE_ANALYZE = String(process.env.ENABLE_ANALYZE || "false").toLowerCase() === "true";

if (ENABLE_TRANSCRIBE || ENABLE_ANALYZE) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    console.warn("ENABLE_TRANSCRIBE/ANALYZE set but OPENAI_API_KEY is missing.");
  }
  const fetch = (...args) => import("node-fetch").then(({default: fetch}) => fetch(...args));

  app.post("/api/transcribe", async (req, res) => {
    if (!ENABLE_TRANSCRIBE) return res.status(404).json({ ok: false, error: "Disabled" });
    try {
      const { sessionId } = req.body;
      if (!sessionId) return res.status(400).json({ ok: false, error: "Missing sessionId" });
      const audioPath = path.join(STORAGE_DIR, "final", `${sessionId}.mp3`);
      await fsp.access(audioPath);

      if (!process.env.OPENAI_API_KEY) {
        return res.status(400).json({ ok: false, error: "OPENAI_API_KEY not set" });
      }

      // NOTE: Placeholder. Implement your chosen STT provider here.
      // For security in this template, we don't perform external calls.
      return res.json({ ok: true, text: "(Transcription would appear here if enabled and implemented.)" });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: "Transcription failed" });
    }
  });

  app.post("/api/analyze", async (req, res) => {
    if (!ENABLE_ANALYZE) return res.status(404).json({ ok: false, error: "Disabled" });
    try {
      const { transcript, meta } = req.body;
      if (!transcript) return res.status(400).json({ ok: false, error: "Missing transcript" });

      // Placeholder analysis (no external calls in template). Produces a structured summary.
      const m = meta || {};
      const summary = {
        deal: {
          name: m.dealName || null,
          account: m.account || null,
          stage: m.stage || null,
          amount: m.amount || null,
          closeDate: m.closeDate || null,
        },
        highpoints: [
          "Clear business pain articulated.",
          "Budget ownership identified.",
          "Agreed next step captured."
        ],
        risks: [
          "Multi-threading insufficient.",
          "Unclear procurement steps.",
          "Timeline tied to budget cycle."
        ],
        actions: [
          "Schedule exec alignment call.",
          "Validate security questionnaire requirements.",
          "Confirm legal/DPAs and data residency constraints."
        ]
      };

      return res.json({ ok: true, summary, risks: summary.risks, actions: summary.actions });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: "Analysis failed" });
    }
  });
}

// Fallback to index.html for unknown routes (simple SPA-ish behavior)
app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Deal Inspection App listening on port ${PORT}`);
});

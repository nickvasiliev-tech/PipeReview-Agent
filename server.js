
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { ProxyAgent, setGlobalDispatcher } from "undici";

dotenv.config({ override: true }); // prefer .env over system vars
// Masked key preview (first 6, last 4) to debug duplication without exposing the secret
const mask = (k)=> (typeof k==='string' && k.length>14 ? (k.slice(0,6) + '...' + k.slice(-4)) : k);
console.log('[ENV] OPENAI_MODEL:', process.env.OPENAI_MODEL || '(default)');
console.log('[ENV] OPENAI_TRANSCRIBE_MODEL:', process.env.OPENAI_TRANSCRIBE_MODEL || '(default)');
console.log('[ENV] OPENAI_API_KEY (masked):', mask(process.env.OPENAI_API_KEY));


// Configure global proxy if HTTPS_PROXY is set
if (process.env.HTTPS_PROXY) {
  try {
    const agent = new ProxyAgent(process.env.HTTPS_PROXY);
    setGlobalDispatcher(agent);
    console.log("[NET] Using HTTPS proxy:", process.env.HTTPS_PROXY);
  } catch (e) {
    console.warn("[NET] Failed to set HTTPS proxy:", e.message);
  }
}


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ---- Logging middleware ----
app.use((req, _res, next) => {
  const start = Date.now();
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  req.__startTime = start;
  next();
});

function logDone(req, label="DONE") {
  const dur = Date.now() - (req.__startTime || Date.now());
  console.log(`[${label}] ${req.method} ${req.originalUrl} ${dur}ms`);
}

// ---- Helpers: timeout + retry wrapper for OpenAI SDK calls ----
function withTimeout(promise, ms, label="operation") {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function retry(fn, opts = {}) {
  const { retries = 2, delayMs = 600, label = "op" } = opts;
  let lastErr;
  for (let i=0; i<=retries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastErr = e;
      console.warn(`[Retry ${i}/${retries}] ${label} failed:`, e?.response?.data || e.message);
      if (i < retries) await new Promise(r => setTimeout(r, delayMs * (i+1)));
    }
  }
  throw lastErr;
}


// Static files
app.use(express.static(path.join(__dirname, "public")));

// Upload handling (memory)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 200 } }); // 200MB max

// Healthcheck
app.get("/api/ping", (_req, res) => { res.json({ ok: true, now: new Date().toISOString() }); });
app.get("/api/health", (_req, res) => { res.json({ ok: true, env: { hasKey: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL, stt: process.env.OPENAI_TRANSCRIBE_MODEL } }); });

app.get("/api/connectivity", async (_req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ ok:false, error: "Missing OPENAI_API_KEY" });
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const t0 = Date.now();
    const r = await openai.models.list();
    const t1 = Date.now();
    res.json({ ok:true, count: (r?.data || []).length, ms: (t1-t0) });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
});

app.get("/api/debug", (_req, res) => { res.json({ ok: true, pid: process.pid, uptime: process.uptime(), tz: process.env.TZ, port: process.env.PORT }); });
app.get("/api/env", (_req, res) => {
  const mask = (k)=> (typeof k==='string' && k.length>14 ? (k.slice(0,6) + '...' + k.slice(-4)) : k);
  res.json({
    ok: true,
    model: process.env.OPENAI_MODEL,
    stt: process.env.OPENAI_TRANSCRIBE_MODEL,
    key_masked: mask(process.env.OPENAI_API_KEY)
  });
});


app.post("/api/process", upload.single("file"), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY in .env" });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "No audio file received" });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log("[INFO] Incoming audio bytes:", req.file.buffer?.length || 0, "language:", req.body?.language);

    // Persist buffer to tmp file
    const uploadsDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const tmpId = uuidv4();
    const tmpPath = path.join(uploadsDir, `${tmpId}.webm`);
    fs.writeFileSync(tmpPath, req.file.buffer);

    // Language hint
    const langHint = (req.body?.language || "auto").toLowerCase();
    const language = langHint.startsWith("ru") ? "ru" : (langHint.startsWith("en") ? "en" : undefined);

    // Guard: file size
    const stat = fs.statSync(tmpPath);
    if (!stat.size || stat.size < 1000) {
      return res.status(400).json({
        error: "Transcription failed",
        detail: "Audio file is empty or too short",
        hint: "Make sure your browser is actually capturing audio. For system audio, tick 'Share system audio'."
      });
    }

    // 1) Transcription with fallbacks
    let transcriptText = "";
    let lastErr = null;
    const candidates = [
      process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1",
      "gpt-4o-mini-transcribe",
      "gpt-4o-transcribe"
    ];

    for (const model of candidates) {
      try {
        console.log("[STT] Trying model:", model);
        const tr = await retry(
          (attempt) => withTimeout(
            openai.audio.transcriptions.create({
              file: fs.createReadStream(tmpPath),
              model,
              response_format: "json",
              temperature: 0,
              language: language || undefined
            }),
            Number(process.env.OPENAI_TIMEOUT_MS || 60000),
            `transcription(${model})`
          ),
          { retries: 2, delayMs: 700, label: `transcription(${model})` }
        );
        if (tr?.text && tr.text.trim().length > 0) {
          transcriptText = tr.text;
          console.log("[STT] Success with:", model, "text len:", transcriptText.length);
          break;
        } else {
          console.warn("[STT] Empty text from model:", model);
        }
      } catch (e) {
        lastErr = e;
        console.error("Transcription error with", model, ":", e?.response?.data || e.message);
      }
    }

    if (!transcriptText) {
      return res.status(500).json({
        error: "Transcription failed",
        detail: lastErr?.message || "Unknown error",
        hint: "Try OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe in .env"
      });
    }

    // 2) GPT parsing
    const today = new Date().toISOString().slice(0, 10);
    const tz = process.env.TZ || "Europe/Madrid";

    const systemPrompt = `
Ты — ассистент по продажам. Из транскрипта (RU/EN) извлеки сделки.
Правила:
- Поддерживай RU/EN. Нормализуй даты в YYYY-MM-DD, учитывая текущую дату ${today} и TZ ${tz}.
- Сегментируй на сделки по смыслу: смена компании/проекта, "новая сделка", "next deal", "перейдём к", "now about".
- Поля: title, account, next_step, next_step_date, risks, stakeholders, amount, stage, summary.
- Суммы как "<число> <валюта>" (например "50000 USD").
- Если поле неизвестно — null или "—".
- Язык твоего ответа - только английский.
Верни только JSON вида:
{
  "session_id": "${today}",
  "language_detected": "<ru|en|mixed>",
  "deals": [
    {
      "title": "<string>",
      "account": "<string|null>",
      "next_step": "<string|null>",
      "next_step_date": "<YYYY-MM-DD|null>",
      "risks": "<string|null>",
      "stakeholders": "<string|null>",
      "amount": "<string|null>",
      "stage": "<string|null>",
      "summary": "<string>"
    }
  ]
}`.trim();

    let parsed;
    try {
      const completion = await retry(
        (attempt) => withTimeout(
          openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o",
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: transcriptText }
            ]
          }),
          Number(process.env.OPENAI_TIMEOUT_MS || 60000),
          "chatCompletion"
        ),
        { retries: 2, delayMs: 800, label: "chatCompletion" }
      );
      parsed = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
    } catch (e) {
      console.error("Parsing error:", e?.response?.data || e.message);
      return res.status(500).json({
        error: "Parsing failed",
        detail: e?.message || String(e),
        transcript_preview: transcriptText.slice(0, 600),
        network: { https_proxy: process.env.HTTPS_PROXY || null }
      });
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }

    if (!parsed || !Array.isArray(parsed.deals)) {
      return res.status(200).json({
        session_id: today,
        language_detected: "unknown",
        deals: [],
        note: "No deals parsed",
        transcript_preview: transcriptText.slice(0, 300)
      });
    }

    res.json(parsed);
    logDone(req, "OK");

  } catch (e) {
    console.error("Server error:", e);
    res.status(500).json({ error: "Server error", detail: e?.message || String(e) });
    logDone(req, "ERR");
  }
});

// SPA fallback
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`AI Deals Recorder v1.2.1 at http://localhost:${port}`);
});


// Parse raw transcript text (manual fallback) -> deals
app.post("/api/parseText", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    const transcriptText = (req.body?.text || "").toString();
    if (!transcriptText.trim()) return res.status(400).json({ error: "No text provided" });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const today = new Date().toISOString().slice(0, 10);
    const tz = process.env.TZ || "Europe/Madrid";
    const systemPrompt = `
Ты — ассистент по продажам. Из транскрипта (RU/EN) извлеки сделки.
Правила: даты -> YYYY-MM-DD (учитывай ${today}, TZ ${tz}); поля: title, account, next_step, next_step_date, risks, stakeholders, amount, stage, summary.
JSON строго по схеме {"session_id":"${today}","language_detected":"<ru|en|mixed>","deals":[{...}]}.
`.trim();

    const completion = await retry(
      () => withTimeout(
        openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-4o",
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: transcriptText }
          ]
        }),
        Number(process.env.OPENAI_TIMEOUT_MS || 60000),
        "chatCompletion(text)"
      ),
      { retries: 2, delayMs: 800, label: "chatCompletion(text)" }
    );

    const parsed = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
    if (!parsed || !Array.isArray(parsed.deals)) return res.json({ deals: [] });
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: "Parse failed", detail: e?.message || String(e) });
  }
});

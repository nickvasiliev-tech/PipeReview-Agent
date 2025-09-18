
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/healthz', (req, res) => res.status(200).send('ok'));

// Configure upload storage (memory)
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB per request (OpenAI limit)

// OpenAI client (optional at runtime)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const AUDIO_MODEL = process.env.AUDIO_MODEL || "gpt-4o-mini-transcribe"; // fallback to new audio STT model
const TEXT_MODEL = process.env.TEXT_MODEL || "gpt-4.1-mini";
const FORCE_ENGLISH = (process.env.FORCE_ENGLISH || "true").toLowerCase() === "true";

let openai = null;
if (OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
}

// POST /api/transcribe — accepts a single file "audio"
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    const buf = req.file.buffer;
    const originalName = req.file.originalname || 'audio.webm';

    if (!openai) {
      // Fallback: no API key configured — return a stub with guidance
      return res.json({
        transcript: "",
        note: "No OPENAI_API_KEY configured on the server. Save your key in .env and restart.",
        language: "unknown"
      });
    }

    // 1) Transcribe with audio model (file upload method)
    const file = new File([buf], originalName, { type: req.file.mimetype || 'audio/webm' });
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: AUDIO_MODEL,
      // language auto-detected; we request verbose JSON if available
      response_format: "verbose_json"
    });

    // The response shape can vary; we normalize a few common fields
    const rawText = transcription.text || transcription.transcript || "";
    const detectedLanguage = transcription.language || "unknown";

    let englishText = rawText;

    if (FORCE_ENGLISH) {
      // If we know it's not English, or always enforce English translation
      // Send to text model for translation (cheap + reliable)
      const system = "You are a translator. Translate the user's text to clear, fluent English. Only return the translation, no extra commentary.";
      const userContent = rawText;
      const translated = await openai.chat.completions.create({
        model: TEXT_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent }
        ],
        temperature: 0.0
      });
      englishText = translated.choices?.[0]?.message?.content?.trim() || rawText;
    }

    return res.json({
      transcript: englishText,
      language: detectedLanguage,
      model: AUDIO_MODEL
    });

  } catch (err) {
    console.error(err);
    const msg = (err && err.message) ? err.message : 'Transcription failed';
    return res.status(500).json({ error: msg });
  }
});

// Example placeholder extraction endpoint (expects text)
app.post('/api/extract', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Missing text' });

    if (!openai) {
      // Return a simple heuristic extraction when no API key is set
      const sample = {
        deals: [
          {
            name: "Unknown Deal",
            stage: "Unspecified",
            probability: null,
            forecastCategory: "Pipeline",
            closeDate: null,
            nextStep: null,
            nextStepDate: null,
            risks: ["No structured extraction (no API key)"],
            strengths: []
          }
        ]
      };
      return res.json(sample);
    }

    const prompt = `You are a sales operations assistant. From the conversation below, extract all distinct sales deals and return JSON with this schema:
{
  "deals": [{
    "name": string,
    "stage": string|null,
    "probability": number|null,
    "forecastCategory": string|null,
    "closeDate": string|null,
    "nextStep": string|null,
    "nextStepOwner": string|null,
    "nextStepDate": string|null,
    "decisionProcess": string|null,
    "competitors": string[],
    "budget": string|null,
    "timeline": string|null,
    "pocInvolved": boolean|null,
    "seInvolved": boolean|null,
    "veeamSpecific": {
      "customerType": string|null,
      "repository": string|null,
      "retention": string|null,
      "dataAmount": string|null,
      "vulEstimate": string|null
    },
    "risks": string[],
    "strengths": string[]
  }]
}

Rules:
- ALWAYS respond with valid JSON only.
- If data is missing, set null or empty array. Do not invent values.
- Conversation may be in Russian originally but text is English; use names as-is (preserve proper nouns).`;

    const completion = await openai.chat.completions.create({
      model: TEXT_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: text }
      ]
    });

    const content = completion.choices?.[0]?.message?.content || "{}";
    // Try to parse JSON in a safe way
    let parsed = {};
    try { parsed = JSON.parse(content); }
    catch { parsed = { deals: [], note: "Model did not return valid JSON. Please retry." }; }

    return res.json(parsed);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Extraction failed' });
  }
});

// Fallback route to index.html for SPA-ish behavior
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Deal Inspection App running on http://localhost:${port}`);
});

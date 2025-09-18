import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Health check
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

const upload = multer({ storage: multer.memoryStorage() });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.warn('OPENAI_API_KEY not set. The API routes will return 500.');
}
const AUDIO_MODEL = process.env.AUDIO_MODEL || 'gpt-4o-mini-transcribe';
const TEXT_MODEL = process.env.TEXT_MODEL || 'gpt-4.1-mini';
const FORCE_ENGLISH = (process.env.FORCE_ENGLISH || 'true').toLowerCase() === 'true';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
    if (!req.file) throw new Error('No audio provided');

    // Transcribe (supports EN + RU), ask model to return language code
    const transcription = await openai.audio.transcriptions.create({
      file: {
        name: req.file.originalname || 'recording.webm',
        data: req.file.buffer
      },
      model: AUDIO_MODEL,
      // If the SDK differs, adjust accordingly; this is written for current OpenAI Node SDK conventions.
      // We'll request JSON with language if available.
      response_format: 'verbose_json'
    });

    const text = transcription.text || '';
    const lang = (transcription.language || 'en').slice(0,2).toLowerCase();

    let transcript_en = text;
    if (FORCE_ENGLISH && lang === 'ru') {
      const tr = await openai.chat.completions.create({
        model: TEXT_MODEL,
        messages: [
          {role:'system', content:'You are a precise translator from Russian to English. Preserve proper nouns as spoken; transliterate Cyrillic names if needed. Return only the translated text.'},
          {role:'user', content:text}
        ],
        temperature: 0.2
      });
      transcript_en = tr.choices?.[0]?.message?.content || text;
    }

    // Minimal diarization proxy (optional): ask model to split lines as Rep/Manager (heuristic)
    // We keep this as meta only, actual diarization requires specialized models.
    const meta = { language: lang };

    res.json({ transcript_en, meta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'TRANSCRIBE_ERROR', detail: String(err.message || err) });
  }
});

app.post('/api/extract', async (req, res) => {
  try {
    if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
    const { transcript_en, meta } = req.body || {};
    if (!transcript_en) throw new Error('Missing transcript_en');

    const sys = [
      'You are a Deal Inspection extractor for Object First / Veeam-aligned sales reviews.',
      'Input is an English transcript of a Rep/Manager review (original EN or translated from RU).',
      'Extract multiple deals if present. Always output JSON with this shape:',
      '{ "deals": [ {',
      '  "name": string,',
      '  "stage": string, "probability": number, "forecast_category": string,',
      '  "close_date": string, "close_date_realism": string,',
      '  "next_step": { "text": string, "owner": string, "date": string },',
      '  "decision_process": string, "competitors": string[], "budget": string, "timeline": string,',
      '  "poc_se": string,',
      '  "customer_type": string, "repository": string, "retention": string, "data_amount": string, "vul_estimate": string,',
      '  "strengths": string[], "risks": string[], "stage_alignment": string,',
      '  "flags": string[]',
      '} ],',
      '"session_summary": { "deals": string[], "actions": string[], "risks": string[] }',
      '}',
      'Rules:',
      '- Auto-detect distinct deal names mentioned; if absent, infer a short descriptive name.',
      '- Preserve proper nouns; if originally Cyrillic, add a transliteration in parentheses once.',
      '- Be conservative: if uncertain, set a field to "" or [] and add a flag explaining what is missing.',
      '- Probability is integer 0-100; Stage/Forecast terms should match typical Salesforce vocabulary.',
      '- Close date realism: flag if date is in past or unrealistic given stage (short justification).',
      '- Veeam/Object First fields: include if discussed; otherwise leave blank and flag as missing.',
      '- Output ONLY the JSON object, no prose.'
    ].join('\n');

    const prompt = [
      { role: 'system', content: sys },
      { role: 'user', content: transcript_en }
    ];

    const ex = await openai.chat.completions.create({
      model: TEXT_MODEL,
      messages: prompt,
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const raw = ex.choices?.[0]?.message?.content || '{}';
    let data;
    try { data = JSON.parse(raw); } catch(e) { data = { deals: [], session_summary: {} }; }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'EXTRACT_ERROR', detail: String(err.message || err) });
  }
});

// Fallback to index.html for root
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on :${PORT}`));

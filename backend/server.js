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
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.get('/healthz', (req,res)=>res.json({status:'ok'}));
const upload = multer({ storage: multer.memoryStorage() });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
const AUDIO_MODEL = process.env.AUDIO_MODEL || 'gpt-4o-mini-transcribe';
const TEXT_MODEL = process.env.TEXT_MODEL || 'gpt-4.1-mini';
const FORCE_ENGLISH = (process.env.FORCE_ENGLISH || 'true').toLowerCase()==='true';
app.post('/api/transcribe', upload.single('audio'), async (req,res)=>{
  try{
    if(!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
    if(!req.file) throw new Error('No audio provided');
    const tr = await openai.audio.transcriptions.create({
      file: { name: req.file.originalname || 'recording.webm', data: req.file.buffer },
      model: AUDIO_MODEL, response_format: 'verbose_json'
    });
    const text = tr.text || ''; const lang = (tr.language || 'en').slice(0,2).toLowerCase();
    let transcript_en = text;
    if(FORCE_ENGLISH && lang==='ru'){
      const rx = await openai.chat.completions.create({
        model: TEXT_MODEL, temperature: 0.2,
        messages:[{role:'system',content:'Translate Russian to English. Preserve proper nouns; transliterate Cyrillic names.'},{role:'user',content:text}]
      });
      transcript_en = rx.choices?.[0]?.message?.content || text;
    }
    res.json({ transcript_en, meta:{ language: lang } });
  }catch(e){console.error(e);res.status(500).json({error:'TRANSCRIBE_ERROR',detail:String(e.message||e)})}
});
app.post('/api/extract', async (req,res)=>{
  try{
    if(!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
    const { transcript_en } = req.body || {};
    if(!transcript_en) throw new Error('Missing transcript_en');
    const sys = 'You are a Deal Inspection extractor... (omitted here for brevity in this quick rebuild).';
    const out = await openai.chat.completions.create({
      model: TEXT_MODEL, temperature: 0.2, response_format:{type:'json_object'},
      messages:[{role:'system',content:sys},{role:'user',content:transcript_en}]
    });
    res.json(JSON.parse(out.choices?.[0]?.message?.content || '{"deals":[],"session_summary":{}}'));
  }catch(e){console.error(e);res.status(500).json({error:'EXTRACT_ERROR',detail:String(e.message||e)})}
});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'..','frontend','index.html')));
const PORT = process.env.PORT || 3000; app.listen(PORT,()=>console.log('Server on :'+PORT));

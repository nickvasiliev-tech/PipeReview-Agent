let mediaRecorder;
let chunks = [];
let recordedBlob = null;
let initialized = false;
let captureStream = null;

let timerInterval = null;
let startTime = null;

const btnInit = document.getElementById('btnInit');
const btnInit = document.getElementById('btnInit');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnTranscribe = document.getElementById('btnTranscribe');
const micStatus = document.getElementById('micStatus');
const player = document.getElementById('player');
const downloadAudio = document.getElementById('downloadAudio');
const statusEl = document.getElementById('status');
const output = document.getElementById('output');
const fileInput = document.getElementById('fileInput');

async function initCapture() {
  const mode = document.querySelector('input[name="capmode"]:checked').value;
  micStatus.textContent = 'Requesting permissions…';
  try {
    let stream;
    if (mode === 'mixed') {
      // Option B — mix Teams tab audio + mic
      const sys = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: false });
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const sysSrc = ctx.createMediaStreamSource(sys);
      const micSrc = ctx.createMediaStreamSource(mic);
      const dest = ctx.createMediaStreamDestination();
      sysSrc.connect(dest);
      micSrc.connect(dest);
      stream = dest.stream; captureStream = stream;
      micStatus.textContent = 'Ready (system audio + mic)';
    } else {
      // Option A — mic only
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream = mic; captureStream = stream;
      micStatus.textContent = 'Ready (mic only)';
    }

    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' }); initialized = true;
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
      recordedBlob = new Blob(chunks, { type: 'audio/webm' });
      chunks = [];
      const url = URL.createObjectURL(recordedBlob);
      player.src = url;
      player.classList.remove('hidden');
      downloadAudio.href = url;
      downloadAudio.classList.remove('hidden');
      btnTranscribe.disabled = false;
      statusEl.textContent = 'Recorded';
    };

    btnStart.disabled = false;
  } catch (e) {
    console.error(e);
    micStatus.textContent = 'Capture denied or unavailable';
    btnStart.disabled = true;
  }
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

btnStart.addEventListener('click', async () => {
  if (!mediaRecorder) await initCapture();
  if (!mediaRecorder) return;
  chunks = [];
  mediaRecorder.start(5000); // collect data every 5s
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    document.getElementById('timer').textContent = formatTime(elapsed);
  }, 500);
  btnStart.disabled = true;
  btnStop.disabled = false;
  btnTranscribe.disabled = true;
  statusEl.textContent = 'Recording…';
});

btnStop.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (timerInterval) clearInterval(timerInterval);
  btnStop.disabled = true;
  btnStart.disabled = false;
});

btnTranscribe.addEventListener('click', async () => {
  if (!recordedBlob) { output.textContent = 'No recording available.'; return; }
  statusEl.textContent = 'Uploading for transcription…';
  const fd = new FormData();
  fd.append('audio', recordedBlob, 'meeting.webm');
  try {
    const resp = await fetch('/api/transcribe', { method: 'POST', body: fd });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Transcription failed');
    const transcript = data.transcript || '';
    // Now extract deals
    statusEl.textContent = 'Extracting deals…';
    const extractResp = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: transcript })
    });
    const extracted = await extractResp.json();
    statusEl.textContent = 'Done';
    output.textContent = JSON.stringify({ transcript, extracted }, null, 2);
  } catch (err) {
    statusEl.textContent = 'Error';
    output.textContent = String(err);
  }
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  recordedBlob = file;
  const url = URL.createObjectURL(file);
  player.src = url;
  player.classList.remove('hidden');
  downloadAudio.href = url;
  downloadAudio.classList.remove('hidden');
  btnTranscribe.disabled = false;
  statusEl.textContent = 'File ready';
});

// Initialize after DOM load
window.addEventListener('load', () => {
  micStatus.textContent = 'Click Initialize to grant capture permissions';
});

btnInit.addEventListener('click', async () => {
  await initCapture();
});

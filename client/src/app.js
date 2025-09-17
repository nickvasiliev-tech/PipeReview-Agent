
// Simple client. Records in 5s chunks and streams to server.
const $ = sel => document.querySelector(sel);

const els = {
  start: $("#btnStart"),
  stop: $("#btnStop"),
  status: $("#status"),
  meter: $("#meterFill"),
  duration: $("#duration"),
  preview: $("#preview"),
  sid: $("#sid"),
  result: $("#resultBox"),

  // deal fields
  dealName: $("#dealName"),
  account: $("#account"),
  stage: $("#stage"),
  amount: $("#amount"),
  closeDate: $("#closeDate"),
  nextStep: $("#nextStep"),
  nextStepDate: $("#nextStepDate"),
  competitors: $("#competitors"),
  notes: $("#notes"),
};

let mediaRecorder, audioChunks = [], sessionId = null, startedAt = 0;
let audioCtx, analyser, sourceNode, rafId;

function fmt(t) {
  const s = Math.floor(t/1000);
  const hh = String(Math.floor(s/3600)).padStart(2,"0");
  const mm = String(Math.floor((s%3600)/60)).padStart(2,"0");
  const ss = String(s%60).padStart(2,"0");
  return `${hh}:${mm}:${ss}`;
}

function gatherMeta() {
  return {
    dealName: els.dealName.value.trim(),
    account: els.account.value.trim(),
    stage: els.stage.value,
    amount: Number(els.amount.value || 0),
    closeDate: els.closeDate.value || null,
    nextStep: els.nextStep.value.trim(),
    nextStepDate: els.nextStepDate.value || null,
    competitors: els.competitors.value.trim(),
    notes: els.notes.value.trim(),
    agent: navigator.userAgent,
    startedAt: startedAt,
  };
}

async function sendChunk(blob, idx) {
  const fd = new FormData();
  fd.append("sessionId", sessionId);
  fd.append("chunkIndex", idx);
  fd.append("meta", JSON.stringify(gatherMeta()));
  fd.append("audio", blob, `chunk-${idx}.webm`);

  const r = await fetch("/api/chunk", { method: "POST", body: fd });
  if (!r.ok) throw new Error("Chunk upload failed");
  return r.json();
}

function startMeter(stream) {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  sourceNode = audioCtx.createMediaStreamSource(stream);
  sourceNode.connect(analyser);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  const loop = () => {
    analyser.getByteTimeDomainData(dataArray);
    let max = 0;
    for (let i=0;i<dataArray.length;i++) {
      const v = Math.abs(dataArray[i]-128);
      if (v>max) max=v;
    }
    const pct = Math.min(100, (max/128)*100);
    els.meter.style.width = pct.toFixed(0) + "%";
    els.duration.textContent = "Duration: " + fmt(Date.now() - startedAt);
    rafId = requestAnimationFrame(loop);
  };
  loop();
}

els.start.onclick = async () => {
  els.start.disabled = true;
  els.stop.disabled = false;
  els.status.textContent = "Requesting mic...";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    sessionId = crypto.randomUUID();
    els.sid.textContent = sessionId;

    startMeter(stream);

    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    let idx = 0;

    mediaRecorder.ondataavailable = async (ev) => {
      if (ev.data && ev.data.size > 0) {
        try {
          await sendChunk(ev.data, idx++);
          els.status.textContent = `Uploaded chunk ${idx}`;
        } catch (e) {
          console.error(e);
          els.status.textContent = "Upload error (check console). Recording continues.";
        }
      }
    };

    mediaRecorder.onstop = async () => {
      cancelAnimationFrame(rafId);
      els.meter.style.width = "0%";
      els.status.textContent = "Finalizing...";

      const r = await fetch("/api/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const j = await r.json();
      if (j.ok) {
        els.status.textContent = "Done.";
        const a = document.createElement("audio");
        a.controls = true;
        a.src = j.fileUrl;
        els.preview.innerHTML = "";
        els.preview.appendChild(a);
        els.result.textContent = "Saved: " + j.fileUrl;
      } else {
        els.status.textContent = "Finalize failed: " + j.error;
      }
    };

    startedAt = Date.now();
    els.status.textContent = "Recording...";
    mediaRecorder.start(5000); // 5s chunks
  } catch (e) {
    console.error(e);
    els.status.textContent = "Mic permission denied or unsupported.";
    els.start.disabled = false;
    els.stop.disabled = true;
  }
};

els.stop.onclick = () => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    els.stop.disabled = true;
    els.start.disabled = false;
  }
};

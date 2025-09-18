const $ = s => document.querySelector(s);
const els = {
  start: $("#btnStart"),
  stop: $("#btnStop"),
  startDeal: $("#btnStartDeal"),
  endDeal: $("#btnEndDeal"),
  status: $("#status"),
  meter: $("#meterFill"),
  duration: $("#duration"),
  preview: $("#preview"),
  sid: $("#sid"),
  result: $("#resultBox"),
  dealsList: $("#dealsList"),
  // fields
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

let mediaRecorder, sessionId = null, startedAt = 0, rafId;
let audioCtx, analyser, sourceNode;

let currentDealId = null;
let markers = []; // {id, name, startMs, endMs|null, meta}

function fmt(t) {
  const s = Math.floor(t/1000);
  const hh = String(Math.floor(s/3600)).padStart(2,"0");
  const mm = String(Math.floor((s%3600)/60)).padStart(2,"0");
  const ss = String(s%60).padStart(2,"0");
  return `${hh}:${mm}:${ss}`;
}

function nowOffsetMs() { return Date.now() - startedAt; }

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
  fd.append("meta", JSON.stringify({ meta: gatherMeta(), markers }));
  fd.append("audio", blob, `chunk-${idx}.webm`);
  const r = await fetch("/api/chunk", { method: "POST", body: fd });
  if (!r.ok) throw new Error("Chunk upload failed");
  return r.json();
}

function renderDeals() {
  els.dealsList.innerHTML = "";
  markers.forEach(m => {
    const item = document.createElement("div");
    item.className = "item" + (m.id === currentDealId ? " active" : "");
    const start = fmt(m.startMs);
    const end = m.endMs != null ? fmt(m.endMs) : "…";
    item.innerHTML = `<div>${m.name || "(untitled)"}<div class="time">${start} – ${end}</div></div>`;
    const btn = document.createElement("button");
    btn.className = "secondary";
    btn.textContent = m.endMs == null ? "End" : "Closed";
    btn.disabled = m.endMs != null;
    btn.onclick = () => { if (m.endMs == null) endCurrentDeal(); };
    item.appendChild(btn);
    els.dealsList.appendChild(item);
  });
}

function startMeter(stream) {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  sourceNode = audioCtx.createMediaStreamSource(stream);
  sourceNode.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const loop = () => {
    analyser.getByteTimeDomainData(data);
    let max = 0; for (let i=0;i<data.length;i++){ const v=Math.abs(data[i]-128); if(v>max) max=v; }
    const pct = Math.min(100, (max/128)*100);
    els.meter.style.width = pct.toFixed(0) + "%";
    els.duration.textContent = "Duration: " + fmt(nowOffsetMs());
    rafId = requestAnimationFrame(loop);
  };
  loop();
}

function startDeal() {
  const meta = gatherMeta();
  const name = meta.dealName || meta.account || `Deal ${markers.length+1}`;
  if (currentDealId != null) endCurrentDeal();
  currentDealId = crypto.randomUUID();
  markers.push({
    id: currentDealId,
    name,
    startMs: nowOffsetMs(),
    endMs: null,
    meta
  });
  renderDeals();
}

function endCurrentDeal() {
  if (currentDealId == null) return;
  const idx = markers.findIndex(m => m.id === currentDealId && m.endMs == null);
  if (idx >= 0) {
    markers[idx].endMs = nowOffsetMs();
  }
  currentDealId = null;
  renderDeals();
}

els.start.onclick = async () => {
  els.start.disabled = true;
  els.stop.disabled = false;
  els.startDeal.disabled = false;
  els.endDeal.disabled = false;
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
          els.status.textContent = "Upload error (recording continues).";
        }
      }
    };
    mediaRecorder.onstop = async () => {
      cancelAnimationFrame(rafId); els.meter.style.width = "0%";
      if (currentDealId != null) endCurrentDeal();

      els.status.textContent = "Finalizing...";
      const payload = { sessionId, markers: markers.map(({id, ...rest}) => rest), totalDurationMs: nowOffsetMs() };
      const r = await fetch("/api/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (j.ok) {
        els.status.textContent = "Done.";
        const a = document.createElement("audio"); a.controls = true; a.src = j.fileUrl;
        els.preview.innerHTML = ""; els.preview.appendChild(a);

        const lines = [];
        lines.push("Session file: " + j.fileUrl);
        if (Array.isArray(j.deals)) {
          j.deals.forEach(d => {
            lines.push(`Deal #${d.index} ${d.name}: ${d.fileUrl}`);
          });
        }
        els.result.textContent = lines.join("\n");
      } else {
        els.status.textContent = "Finalize failed: " + j.error;
      }
    };

    startedAt = Date.now();
    els.status.textContent = "Recording...";
    mediaRecorder.start(5000);
  } catch (e) {
    console.error(e);
    els.status.textContent = "Mic permission denied or unsupported.";
    els.start.disabled = false;
    els.stop.disabled = true;
    els.startDeal.disabled = true;
    els.endDeal.disabled = true;
  }
};

els.stop.onclick = () => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    els.stop.disabled = true;
    els.start.disabled = false;
    els.startDeal.disabled = true;
    els.endDeal.disabled = true;
  }
};

els.startDeal.onclick = startDeal;
els.endDeal.onclick = endCurrentDeal;

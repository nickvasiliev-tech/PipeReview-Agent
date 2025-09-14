let mediaRecorder;
let chunks = [];
let recording = false;
let startTs = 0;
let timerInterval;
let stream = null;

const els = {
  start: document.getElementById("startBtn"),
  stop: document.getElementById("stopBtn"),
  status: document.getElementById("status"),
  timer: document.getElementById("timer"),
  deals: document.getElementById("dealsContainer"),
  exportCsv: document.getElementById("exportCsvBtn"),
  copyAll: document.getElementById("copyAllBtn"),
  lang: document.getElementById("language")
};

function fmt(ms){ const s=Math.floor(ms/1000); const m=String(Math.floor(s/60)).padStart(2,"0"); const ss=String(s%60).padStart(2,"0"); return `${m}:${ss}`; }

async function startRecording(){
  const mode = document.querySelector('input[name="mode"]:checked').value;
  try{
    if (mode === "mic"){
      stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    } else {
      stream = await navigator.mediaDevices.getDisplayMedia({ video:true, audio:true });
      if (!stream.getAudioTracks().length) {
        alert("No system audio track detected. In Chrome/Edge on Windows, share Entire screen and tick 'Share system audio'.");
      }
    }
  }catch(e){
    alert("Cannot access media: " + e.message);
    return;
  }

  chunks = [];
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : undefined;
  try{
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  }catch(e){
    alert("MediaRecorder init failed: " + e.message);
    return;
  }

  mediaRecorder.ondataavailable = (ev)=>{ if(ev.data && ev.data.size>0) chunks.push(ev.data); };
  mediaRecorder.onstop = handleStop;

  mediaRecorder.start();
  recording = true;
  startTs = Date.now();
  els.start.disabled = true;
  els.stop.disabled = false;
  els.status.textContent = "Recording…";
  timerInterval = setInterval(()=> els.timer.textContent = fmt(Date.now()-startTs), 250);
}

function stopRecording(){
  if (!recording) return;
  recording = false;
  els.stop.disabled = true;
  els.status.textContent = "Processing…";
  clearInterval(timerInterval);
  try{ mediaRecorder.stop(); }catch{}
  if (stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
}

async function handleStop(){
  const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
  if (blob.size < 1000){
    alert("Recorded file seems empty. Make sure the browser is capturing audio.");
  }
  const fd = new FormData();
  fd.append("file", blob, "recording.webm");
  fd.append("language", els.lang.value);

  try{
    const r = await fetch("/api/process", { method:"POST", body: fd });
    const data = await r.json();
    if (!r.ok){
      throw new Error((data && (data.detail || data.error)) || ("HTTP " + r.status));
    }
    renderDeals(data.deals || []);
    els.status.textContent = "Done";
    els.start.disabled = false;
    els.exportCsv.disabled = (dealsData.length === 0);
    els.copyAll.disabled = (dealsData.length === 0);
  }catch(e){
    console.error(e);
    alert("Processing failed: " + e.message);
    els.status.textContent = "Error";
    els.start.disabled = false;
  }
}

let dealsData = [];
function renderDeals(deals){
  dealsData = deals;
  els.deals.innerHTML = "";
  if (!deals || deals.length === 0){
    els.deals.innerHTML = '<div class="text-sm text-gray-500">No deals detected.</div>';
    return;
  }
  deals.forEach((d, i)=>{
    const card = document.createElement("div");
    card.className = "bg-white rounded-2xl shadow p-4 border";
    card.innerHTML = `
      <div class="flex items-start justify-between gap-4">
        <div>
          <h3 class="font-bold text-lg">${esc(d.title || ("Deal " + (i+1)))}</h3>
          <div class="text-sm text-gray-600">${esc(d.account || "")}</div>
        </div>
        <button class="px-3 py-1 text-sm rounded-lg bg-gray-800 text-white" data-i="${i}">Copy</button>
      </div>
      <div class="grid md:grid-cols-2 gap-3 mt-3 text-sm">
        <div><b>Next Step:</b> ${esc(d.next_step || "—")}</div>
        <div><b>Date:</b> ${esc(d.next_step_date || "—")}</div>
        <div><b>Risks:</b> ${esc(d.risks || "—")}</div>
        <div><b>Stakeholders:</b> ${esc(d.stakeholders || "—")}</div>
        <div><b>Amount/Stage:</b> ${esc((d.amount || "—") + " / " + (d.stage || "—"))}</div>
      </div>
      <div class="mt-3 text-sm"><b>Summary:</b> ${esc(d.summary || "—")}</div>
    `;
    card.querySelector("button[data-i]").addEventListener("click", ()=> copyDeal(deals[i]));
    els.deals.appendChild(card);
  });
}

function copyDeal(d){
  const md = [
    `# Deal: ${d.title || ""}`,
    `Account: ${d.account || "—"}`,
    `Next Step: ${d.next_step || "—"}`,
    `Next Step Date: ${d.next_step_date || "—"}`,
    `Risks: ${d.risks || "—"}`,
    `Stakeholders: ${d.stakeholders || "—"}`,
    `Amount: ${d.amount || "—"}`,
    `Stage: ${d.stage || "—"}`,
    `Summary: ${d.summary || "—"}`
  ].join("\n");
  navigator.clipboard.writeText(md).then(()=> alert("Deal copied."));
}

function esc(s){ return String(s||"").replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }

function exportCsv(){
  if (!dealsData.length) return;
  const header = ["Title","Account","Next Step","Next Step Date","Risks","Stakeholders","Amount","Stage","Summary"];
  const rows = dealsData.map(d=>[ d.title||"", d.account||"", d.next_step||"", d.next_step_date||"", d.risks||"", d.stakeholders||"", d.amount||"", d.stage||"", (d.summary||"").replace(/\n+/g," ").trim() ]);
  const csv = [header, ...rows].map(r=> r.map(x=> `"${String(x).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "deals.csv"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

els.exportCsv.addEventListener("click", exportCsv);
els.copyAll.addEventListener("click", ()=>{
  if (!dealsData.length) return;
  const blocks = dealsData.map(d=> [
    `# Deal: ${d.title || ""}`,
    `Account: ${d.account || "—"}`,
    `Next Step: ${d.next_step || "—"}`,
    `Next Step Date: ${d.next_step_date || "—"}`,
    `Risks: ${d.risks || "—"}`,
    `Stakeholders: ${d.stakeholders || "—"}`,
    `Amount: ${d.amount || "—"}`,
    `Stage: ${d.stage || "—"}`,
    `Summary: ${d.summary || "—"}`,
    ``
  ].join("\n")).join("\n");
  navigator.clipboard.writeText(blocks).then(()=> alert("All deals copied."));
});

document.getElementById("manualParseBtn").addEventListener("click", async ()=>{
  const t = document.getElementById("manualTranscript").value.trim();
  if (!t) { alert("Paste transcript first."); return; }
  try {
    const r = await fetch("/api/parseText", { method:"POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify({ text: t }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || ("HTTP " + r.status));
    renderDeals(data.deals || []);
  } catch(e) {
    alert("Parse failed: " + e.message);
  }
});

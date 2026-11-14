import { StrokeAnalyzer, LM, toCSV, summarize } from './analyzer.js';

const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'), stage: $('stage'), video: $('video'), canvas: $('overlay'), flash: $('flash'),
  liveSpeed: $('liveSpeed'), liveSpeedVal: $('liveSpeedVal'), progress: $('progress'),
  fileInput: $('fileInput'), cameraBtn: $('cameraBtn'), analyzeBtn: $('analyzeBtn'), stopBtn: $('stopBtn'),
  playBtn: $('playBtn'), stepBack: $('stepBack'), stepFwd: $('stepFwd'), seek: $('seek'), timeLabel: $('timeLabel'),
  rate: $('rate'), timeline: $('timeline'), hand: $('hand'), height: $('height'), sens: $('sens'),
  analysisRate: $('analysisRate'), showSkeleton: $('showSkeleton'), showTrail: $('showTrail'),
  exportBtn: $('exportBtn'), strokeList: $('strokeList'), chart: $('chart'),
  kTotal: $('kTotal'), kMax: $('kMax'), kScore: $('kScore'),
  cFh: $('cFh'), cBh: $('cBh'), cSv: $('cSv'), sFh: $('sFh'), sBh: $('sBh'), sSv: $('sSv'),
};
const ctx = els.canvas.getContext('2d');
const video = els.video;

const TYPE_COLOR = { forehand: '#2f80ed', backhand: '#e2558a', serve: '#f2a33a' };
const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [15, 19], [16, 20],
];

const analyzer = new StrokeAnalyzer();
let landmarker = null;
let mode = 'idle'; // 'idle' | 'file' | 'camera'
let analyzing = false;
let loopActive = false;
let lastTs = 0;
let trail = [];
let lastFrameT = 0;
let replayStop = null;
let filter = 'all';
let openId = null;
let camStream = null;
let recorder = null;
let recChunks = [];
let camStart = 0;
let fileUrl = null;

// ---------------- Model ----------------
async function loadModel() {
  setStatus('AI-model laden…');
  try {
    const { PoseLandmarker, FilesetResolver } = await import(`${MP_BASE}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = (delegate) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      landmarker = await make('GPU');
    } catch {
      landmarker = await make('CPU');
    }
    setStatus('Klaar – upload een video of start de camera', 'ok');
    if (mode === 'file') els.analyzeBtn.disabled = false;
  } catch (e) {
    console.error(e);
    setStatus('Kon het AI-model niet laden. Controleer je internetverbinding.', 'err');
  }
}

function setStatus(text, cls = '') {
  els.status.textContent = text;
  els.status.className = `status ${cls}`;
}

// ---------------- Settings ----------------
function applySettings() {
  analyzer.setOptions({
    rightHanded: els.hand.value === 'right',
    playerHeightM: (Number(els.height.value) || 180) / 100,
    speedThreshold: 9 - Number(els.sens.value) * 0.7,
  });
  try {
    localStorage.setItem('slagscan', JSON.stringify({ hand: els.hand.value, height: els.height.value, sens: els.sens.value }));
  } catch {}
}
try {
  const saved = JSON.parse(localStorage.getItem('slagscan') || '{}');
  if (saved.hand) els.hand.value = saved.hand;
  if (saved.height) els.height.value = saved.height;
  if (saved.sens) els.sens.value = saved.sens;
} catch {}
[els.hand, els.height, els.sens].forEach((el) => el.addEventListener('change', applySettings));
applySettings();

// ---------------- Bronnen ----------------
els.fileInput.addEventListener('change', () => {
  const f = els.fileInput.files?.[0];
  if (!f) return;
  stopCamera(false);
  loadVideoSrc(URL.createObjectURL(f));
  setStatus(`Video geladen: ${f.name}`, 'ok');
});

function loadVideoSrc(url, keepStrokes = false) {
  if (fileUrl && fileUrl !== url) URL.revokeObjectURL(fileUrl);
  fileUrl = url;
  mode = 'file';
  video.srcObject = null;
  video.src = url;
  video.muted = true;
  els.stage.classList.remove('empty', 'mirror');
  els.analyzeBtn.disabled = !landmarker;
  [els.playBtn, els.stepBack, els.stepFwd, els.seek].forEach((b) => (b.disabled = false));
  if (!keepStrokes) {
    analyzer.reset();
    renderAll();
  }
}

video.addEventListener('loadedmetadata', async () => {
  // Chrome geeft bij opgenomen webm soms duration = Infinity
  if (video.duration === Infinity) {
    video.currentTime = 1e101;
    await new Promise((r) => video.addEventListener('durationchange', r, { once: true }));
    video.currentTime = 0;
  }
  sizeCanvas();
  updateTime();
  renderTimeline();
});

function sizeCanvas() {
  els.canvas.width = video.videoWidth || 1280;
  els.canvas.height = video.videoHeight || 720;
  if (video.videoWidth) els.stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
}

els.cameraBtn.addEventListener('click', async () => {
  if (mode === 'camera') return stopCamera(true);
  if (!landmarker) return setStatus('Even wachten tot het AI-model geladen is…');
  const touch = matchMedia('(pointer: coarse)').matches;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: touch ? 'environment' : 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
      audio: false,
    });
  } catch (e) {
    return setStatus('Geen toegang tot de camera.', 'err');
  }
  pauseVideo();
  mode = 'camera';
  video.removeAttribute('src');
  video.srcObject = camStream;
  els.stage.classList.remove('empty');
  els.stage.classList.toggle('mirror', !touch);
  [els.playBtn, els.stepBack, els.stepFwd, els.seek, els.analyzeBtn].forEach((b) => (b.disabled = true));
  analyzer.reset();
  renderAll();
  await video.play();
  sizeCanvas();
  // neem de sessie op zodat je slagen achteraf kunt terugkijken
  recChunks = [];
  try {
    recorder = new MediaRecorder(camStream);
    recorder.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
    recorder.start(1000);
  } catch {
    recorder = null;
  }
  camStart = performance.now();
  analyzing = true;
  els.cameraBtn.textContent = '■ Camera stoppen';
  els.liveSpeed.hidden = false;
  setStatus('Live analyse actief – sla maar!', 'ok');
  startLoop();
});

function stopCamera(loadRecording) {
  if (mode !== 'camera') return;
  analyzing = false;
  loopActive = false;
  els.cameraBtn.textContent = '🎥 Live camera';
  els.liveSpeed.hidden = true;
  const finish = () => {
    camStream?.getTracks().forEach((t) => t.stop());
    camStream = null;
    if (loadRecording && recChunks.length) {
      const blob = new Blob(recChunks, { type: recorder?.mimeType || 'video/webm' });
      loadVideoSrc(URL.createObjectURL(blob), true);
      setStatus(`Sessie opgenomen – ${analyzer.strokes.length} slagen. Klik een slag om terug te kijken.`, 'ok');
    } else {
      mode = 'idle';
      video.srcObject = null;
      els.stage.classList.add('empty');
    }
  };
  if (recorder && recorder.state !== 'inactive') {
    recorder.onstop = finish;
    recorder.stop();
  } else finish();
}

// ---------------- Analyse ----------------
let cancelAnalysis = false;
els.analyzeBtn.addEventListener('click', () => analyzeFile());
els.stopBtn.addEventListener('click', () => (cancelAnalysis = true));

function waitSeek(t) {
  return new Promise((resolve) => {
    const done = () => {
      if (video.requestVideoFrameCallback) {
        // wacht tot het nieuwe frame echt getekend is (met vangnet)
        let fired = false;
        video.requestVideoFrameCallback(() => { fired = true; resolve(); });
        setTimeout(() => !fired && resolve(), 150);
      } else resolve();
    };
    video.addEventListener('seeked', done, { once: true });
    video.currentTime = t;
  });
}

/**
 * Loopt de video frame voor frame door. Langzamer dan afspelen, maar
 * er wordt geen enkel frame overgeslagen – ook niet op trage telefoons.
 */
async function analyzeFile() {
  if (!landmarker || mode !== 'file' || analyzing) return;
  applySettings();
  pauseVideo();
  analyzer.reset();
  trail = [];
  openId = null;
  renderAll();
  analyzing = true;
  cancelAnalysis = false;
  els.analyzeBtn.disabled = true;
  els.stopBtn.hidden = false;
  els.progress.hidden = false;
  els.liveSpeed.hidden = false;
  setStatus('Analyseren…');

  const fps = Number(els.analysisRate.value);
  const dur = video.duration;
  const started = performance.now();
  for (let i = 0; i * (1 / fps) < dur && !cancelAnalysis; i++) {
    const t = i / fps;
    await waitSeek(t);
    processFrame(t);
    updateTime();
    if (i % 15 === 0) {
      const pct = (t / dur) * 100;
      const el = (performance.now() - started) / 1000;
      const left = pct > 3 ? Math.round((el / pct) * (100 - pct)) : null;
      setStatus(`Analyseren… ${Math.round(pct)}%${left != null ? ` · nog ~${left}s` : ''}`);
    }
  }
  finishAnalysis(cancelAnalysis);
}

function finishAnalysis(stopped) {
  analyzing = false;
  pauseVideo();
  video.playbackRate = Number(els.rate.value);
  els.analyzeBtn.disabled = false;
  els.analyzeBtn.textContent = '↻ Opnieuw analyseren';
  els.stopBtn.hidden = true;
  els.progress.hidden = true;
  els.liveSpeed.hidden = true;
  const n = analyzer.strokes.length;
  setStatus(
    n ? `${stopped ? 'Gestopt' : 'Klaar'} – ${n} slag${n === 1 ? '' : 'en'} gevonden. Klik een slag voor details.`
      : 'Geen slagen gevonden. Probeer de gevoeligheid te verhogen of film het hele lichaam.',
    n ? 'ok' : 'err',
  );
}

// ---------------- Frame-loop ----------------
function startLoop() {
  if (loopActive) return;
  loopActive = true;
  schedule();
}
function schedule() {
  if (!loopActive) return;
  if (mode === 'file' && video.requestVideoFrameCallback) {
    video.requestVideoFrameCallback((now, meta) => tick(meta.mediaTime));
  } else {
    requestAnimationFrame(() => tick(video.currentTime));
  }
}
function tick(mediaTime) {
  if (!loopActive) return;
  const t = mode === 'camera' ? (performance.now() - camStart) / 1000 : mediaTime;
  processFrame(t);
  if (replayStop != null && video.currentTime >= replayStop) {
    replayStop = null;
    pauseVideo();
  }
  updateTime();
  schedule();
}

video.addEventListener('play', () => {
  els.playBtn.textContent = '⏸';
  startLoop();
});
video.addEventListener('pause', () => {
  els.playBtn.textContent = '⏯';
  if (mode === 'file') loopActive = false;
});
video.addEventListener('seeked', () => {
  if (video.paused && mode === 'file' && !analyzing) {
    trail = [];
    processFrame(video.currentTime);
    updateTime();
  }
});

function processFrame(t) {
  if (!landmarker || video.readyState < 2) return;
  if (els.canvas.width !== video.videoWidth && video.videoWidth) sizeCanvas();
  const ts = Math.max(performance.now(), lastTs + 1);
  lastTs = ts;
  let res;
  try {
    res = landmarker.detectForVideo(video, ts);
  } catch (e) {
    console.warn(e);
    return;
  }
  const raw = res?.landmarks?.[0];
  const W = els.canvas.width;
  const H = els.canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!raw) return;
  const lm = raw.map((p) => ({ x: p.x * W, y: p.y * H, v: p.visibility ?? 1 }));

  if (Math.abs(t - lastFrameT) > 0.3) trail = [];
  lastFrameT = t;
  const wi = els.hand.value === 'right' ? LM.R_WRIST : LM.L_WRIST;
  trail.push({ x: lm[wi].x, y: lm[wi].y });
  if (trail.length > 16) trail.shift();

  draw(lm);

  if (analyzing) {
    const stroke = analyzer.addFrame(t, lm);
    const f = analyzer.frames[analyzer.frames.length - 1];
    if (f) {
      const kmh = f.speed * analyzer.torsoPx() * analyzer.metersPerPx() * 3.6 * analyzer.opts.racketFactor;
      els.liveSpeedVal.textContent = Math.round(kmh);
    }
    if (stroke) onStroke(stroke);
      if (mode === 'file' && video.duration) {
      els.progress.firstElementChild.style.width = `${(t / video.duration) * 100}%`;
    }
  }
}

function draw(lm) {
  const W = els.canvas.width;
  const scale = W / 1280;
  const dom = els.hand.value === 'right' ? [12, 14, 16, 20] : [11, 13, 15, 19];

  if (els.showTrail.checked && trail.length > 1) {
    for (let i = 1; i < trail.length; i++) {
      const a = i / trail.length;
      ctx.strokeStyle = `rgba(215, 243, 74, ${a})`;
      ctx.lineWidth = (2 + 8 * a) * scale;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
  }
  if (!els.showSkeleton.checked) return;
  ctx.lineCap = 'round';
  for (const [a, b] of BONES) {
    if (lm[a].v < 0.3 || lm[b].v < 0.3) continue;
    const hot = dom.includes(a) && dom.includes(b);
    ctx.strokeStyle = hot ? '#d7f34a' : 'rgba(255,255,255,0.85)';
    ctx.lineWidth = (hot ? 6 : 4) * scale;
    ctx.beginPath();
    ctx.moveTo(lm[a].x, lm[a].y);
    ctx.lineTo(lm[b].x, lm[b].y);
    ctx.stroke();
  }
  for (let i = 11; i <= 28; i++) {
    if (lm[i].v < 0.3 || (i > 16 && i < 23)) continue;
    ctx.fillStyle = dom.includes(i) ? '#d7f34a' : '#3fbf80';
    ctx.beginPath();
    ctx.arc(lm[i].x, lm[i].y, 5 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  // hoofd
  if (lm[0].v > 0.3) {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3 * scale;
    ctx.beginPath();
    ctx.arc(lm[0].x, lm[0].y, 14 * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function onStroke(s) {
  els.flash.hidden = false;
  els.flash.style.background = TYPE_COLOR[s.type];
  els.flash.textContent = `${s.label.toUpperCase()} · ${Math.round(s.racketKmh)} km/u · ${s.score}`;
  // animatie herstarten
  els.flash.style.animation = 'none';
  void els.flash.offsetWidth;
  els.flash.style.animation = '';
  renderAll();
}

// ---------------- Speler ----------------
function pauseVideo() {
  if (!video.paused) video.pause();
}
els.playBtn.addEventListener('click', () => {
  if (mode !== 'file') return;
  replayStop = null;
  if (video.paused) {
    if (!analyzing) video.playbackRate = Number(els.rate.value);
    video.play();
  } else pauseVideo();
});
const FRAME = 1 / 30;
els.stepBack.addEventListener('click', () => { pauseVideo(); video.currentTime = Math.max(0, video.currentTime - FRAME); });
els.stepFwd.addEventListener('click', () => { pauseVideo(); video.currentTime = Math.min(video.duration || 0, video.currentTime + FRAME); });
els.seek.addEventListener('input', () => {
  if (!video.duration) return;
  video.currentTime = (els.seek.value / 1000) * video.duration;
});
els.rate.addEventListener('change', () => { if (!analyzing) video.playbackRate = Number(els.rate.value); });
document.addEventListener('keydown', (e) => {
  if (mode !== 'file' || e.target.matches('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); els.playBtn.click(); }
  if (e.code === 'ArrowLeft') els.stepBack.click();
  if (e.code === 'ArrowRight') els.stepFwd.click();
});

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function updateTime() {
  if (mode !== 'file' || !isFinite(video.duration)) {
    els.timeLabel.textContent = mode === 'camera' ? 'LIVE' : '0:00';
    return;
  }
  els.timeLabel.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
  if (document.activeElement !== els.seek) els.seek.value = Math.round((video.currentTime / video.duration) * 1000);
}

function replay(s) {
  if (mode !== 'file') return;
  analyzing = false;
  els.progress.hidden = true;
  els.stopBtn.hidden = true;
  els.analyzeBtn.disabled = false;
  video.playbackRate = 0.25;
  video.currentTime = Math.max(0, s.t - 1.0);
  replayStop = s.t + 0.8;
  video.play();
}

// ---------------- Weergave ----------------
function renderAll() {
  renderSummary();
  renderList();
  renderChart();
  renderTimeline();
}

function renderSummary() {
  const sum = summarize(analyzer.strokes);
  els.kTotal.textContent = sum.total;
  els.kMax.textContent = sum.total ? Math.round(sum.maxSpeed) : '–';
  els.kScore.textContent = sum.total ? Math.round(sum.avgScore) : '–';
  const t = sum.types;
  els.cFh.textContent = t.forehand.count;
  els.cBh.textContent = t.backhand.count;
  els.cSv.textContent = t.serve.count;
  const line = (x) => (x.count ? `gem. ${Math.round(x.avgSpeed)} km/u · ${Math.round(x.avgScore)}` : '–');
  els.sFh.textContent = line(t.forehand);
  els.sBh.textContent = line(t.backhand);
  els.sSv.textContent = line(t.serve);
  els.exportBtn.disabled = !sum.total;
}

function ring(score, color) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return `<div class="ring"><svg width="48" height="48"><circle cx="24" cy="24" r="${r}" fill="none" stroke="var(--line)" stroke-width="5"/>
    <circle cx="24" cy="24" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"
    stroke-dasharray="${(c * score) / 100} ${c}"/></svg><b>${score}</b></div>`;
}

const PART_LABEL = { snelheid: 'Snelheid', knieen: 'Kniebuiging', rotatie: 'Rotatie', arm: 'Armpositie', contact: 'Raakpunt', uitzwaai: 'Uitzwaai' };

function renderList() {
  const list = analyzer.strokes.filter((s) => filter === 'all' || s.type === filter).slice().reverse();
  if (!list.length) {
    els.strokeList.innerHTML = `<li class="empty-list">${analyzer.strokes.length ? 'Geen slagen van dit type.' : 'Nog geen slagen. Start een analyse.'}</li>`;
    return;
  }
  els.strokeList.innerHTML = list.map((s) => {
    const color = TYPE_COLOR[s.type];
    const scoreColor = s.score >= 75 ? '#3fbf80' : s.score >= 50 ? '#f2a33a' : '#e2558a';
    const bars = Object.entries(s.parts).map(([k, v]) =>
      `<span>${PART_LABEL[k]}</span><div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div><em>${Math.round(v * 100)}</em>`).join('');
    return `<li class="stroke ${openId === s.id ? 'open' : ''}" data-id="${s.id}">
      ${ring(s.score, scoreColor)}
      <div class="meta">
        <strong><span class="badge" style="background:${color}"></span>#${s.id} ${s.label}</strong>
        <small>${mode === 'file' || video.src ? fmt(s.t) + ' · ' : ''}${s.contact}</small>
      </div>
      <div class="speed">${Math.round(s.racketKmh)}<small>km/u</small></div>
      <div class="detail">
        <div class="bars">${bars}</div>
        <ul>${s.tips.map((t) => `<li>${t}</li>`).join('')}</ul>
        <div class="facts">Pols ${Math.round(s.wristKmh)} km/u · knie ${Math.round(s.kneeAngle)}° · elleboog ${s.elbowAngle == null ? 'n.v.t. (camerahoek)' : Math.round(s.elbowAngle) + '°'} · schouderdraai ${Math.round(s.shoulderTurn)}%</div>
        ${mode === 'file' ? '<button class="btn small replay">🔁 Slow-motion terugkijken</button>' : ''}
      </div>
    </li>`;
  }).join('');
}

els.strokeList.addEventListener('click', (e) => {
  const li = e.target.closest('.stroke');
  if (!li) return;
  const s = analyzer.strokes.find((x) => x.id === Number(li.dataset.id));
  if (!s) return;
  if (e.target.closest('.replay')) return replay(s);
  openId = openId === s.id ? null : s.id;
  renderList();
  if (mode === 'file' && !analyzing) {
    pauseVideo();
    video.currentTime = s.contactT ?? s.t;
  }
});

document.querySelectorAll('.chip').forEach((c) =>
  c.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c));
    filter = c.dataset.filter;
    renderList();
  }),
);

function renderTimeline() {
  if (mode !== 'file' || !isFinite(video.duration) || !video.duration) {
    els.timeline.innerHTML = '';
    return;
  }
  els.timeline.innerHTML = analyzer.strokes
    .map((s) => `<button title="#${s.id} ${s.label} – ${Math.round(s.racketKmh)} km/u" data-id="${s.id}"
      style="left:${(s.t / video.duration) * 100}%;background:${TYPE_COLOR[s.type]}"></button>`)
    .join('');
}
els.timeline.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const s = analyzer.strokes.find((x) => x.id === Number(b.dataset.id));
  if (s) {
    openId = s.id;
    renderList();
    replay(s);
  }
});

function renderChart() {
  const cv = els.chart;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 340;
  const h = 140;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const muted = css.getPropertyValue('--muted').trim();
  const line = css.getPropertyValue('--line').trim();
  const strokes = analyzer.strokes;
  c.font = '11px Inter, system-ui, sans-serif';
  if (!strokes.length) {
    c.fillStyle = muted;
    c.textAlign = 'center';
    c.fillText('Racketsnelheid per slag verschijnt hier', w / 2, h / 2);
    return;
  }
  const max = Math.max(60, ...strokes.map((s) => s.racketKmh)) * 1.1;
  const left = 30, bottom = 18, top = 8;
  const plotH = h - bottom - top;
  c.strokeStyle = line;
  c.fillStyle = muted;
  c.textAlign = 'right';
  for (let v = 0; v <= max; v += max > 150 ? 50 : 25) {
    const y = top + plotH - (v / max) * plotH;
    c.beginPath();
    c.moveTo(left, y);
    c.lineTo(w, y);
    c.stroke();
    c.fillText(String(v), left - 6, y + 4);
  }
  const shown = strokes.slice(-40);
  const bw = (w - left - 4) / shown.length;
  shown.forEach((s, i) => {
    const bh = (s.racketKmh / max) * plotH;
    c.fillStyle = TYPE_COLOR[s.type];
    const x = left + 2 + i * bw;
    const barW = Math.max(2, bw - 3);
    c.beginPath();
    if (c.roundRect) c.roundRect(x, top + plotH - bh, barW, bh, [3, 3, 0, 0]);
    else c.rect(x, top + plotH - bh, barW, bh);
    c.fill();
  });
  c.fillStyle = muted;
  c.textAlign = 'left';
  c.fillText('km/u', 0, h - 4);
}
window.addEventListener('resize', renderChart);

els.exportBtn.addEventListener('click', () => {
  const blob = new Blob([toCSV(analyzer.strokes)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `slagscan-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

renderAll();
window.__slagscan = analyzer; // handig voor debuggen in de console
loadModel();

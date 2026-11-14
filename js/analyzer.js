// SlagScan – pure analyse-logica (geen DOM), zodat het los te testen is.
// Werkt op MediaPipe Pose landmarks omgerekend naar pixels.

export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
};

export const STROKE_LABELS = {
  forehand: 'Forehand',
  backhand: 'Backhand',
  serve: 'Opslag / smash',
};

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const len = (v) => Math.hypot(v.x, v.y);
const dist = (a, b) => len(sub(a, b));
const dot = (a, b) => a.x * b.x + a.y * b.y;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Hoek ABC in graden (bij punt B). */
export function angle(a, b, c) {
  const v1 = sub(a, b);
  const v2 = sub(c, b);
  const d = len(v1) * len(v2);
  if (!d) return 180;
  return (Math.acos(clamp(dot(v1, v2) / d, -1, 1)) * 180) / Math.PI;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * StrokeAnalyzer: voer frames in (tijd in seconden + landmarks in pixels),
 * en het herkent slagen op basis van de polssnelheid van de slaghand.
 */
export class StrokeAnalyzer {
  constructor(opts = {}) {
    this.opts = {
      rightHanded: true,
      playerHeightM: 1.8,
      // drempel in torsolengtes per seconde
      speedThreshold: 5.5,
      minGap: 0.7, // s tussen twee slagen
      racketFactor: 2.8, // racketkop ≈ 2.8x zo snel als de pols (langere hefboom + polsrelease)
      ...opts,
    };
    this.reset();
  }

  setOptions(o) {
    Object.assign(this.opts, o);
  }

  reset() {
    this.frames = [];
    this.strokes = [];
    this.torsoHistory = [];
    this.smoothSpeed = 0;
    this.swing = null;
    this.lastStrokeT = -Infinity;
  }

  get idx() {
    const r = this.opts.rightHanded;
    return {
      wrist: r ? LM.R_WRIST : LM.L_WRIST,
      elbow: r ? LM.R_ELBOW : LM.L_ELBOW,
      shoulder: r ? LM.R_SHOULDER : LM.L_SHOULDER,
      offShoulder: r ? LM.L_SHOULDER : LM.R_SHOULDER,
    };
  }

  /** Mediaan torsolengte in pixels (robuust tegen draaien van het lichaam). */
  torsoPx() {
    return median(this.torsoHistory) || 1;
  }

  /** meter per pixel: torso (schouder-heup) ≈ 30% van de lichaamslengte. */
  metersPerPx() {
    return (0.3 * this.opts.playerHeightM) / this.torsoPx();
  }

  /**
   * @param {number} t tijd in seconden
   * @param {Array<{x:number,y:number,v?:number}>} lm landmarks in pixels
   * @returns {object|null} een nieuwe slag als die net is afgerond
   */
  addFrame(t, lm) {
    if (!lm || lm.length < 29) return null;
    const prev = this.frames[this.frames.length - 1];
    if (prev && t <= prev.t) {
      // terugspoelen: begin opnieuw met de buffer
      if (prev.t - t > 0.5) this.frames = [];
      else return null;
    }

    const sh = mid(lm[LM.L_SHOULDER], lm[LM.R_SHOULDER]);
    const hp = mid(lm[LM.L_HIP], lm[LM.R_HIP]);
    const torso = dist(sh, hp);
    if (torso > 2) {
      this.torsoHistory.push(torso);
      if (this.torsoHistory.length > 90) this.torsoHistory.shift();
    }

    const { wrist } = this.idx;
    let speed = 0;
    const last = this.frames[this.frames.length - 1];
    if (last) {
      const dt = t - last.t;
      if (dt > 0 && dt < 0.25) {
        speed = dist(lm[wrist], last.lm[wrist]) / dt / this.torsoPx();
      }
    }
    // lichte smoothing tegen jitter
    this.smoothSpeed = this.smoothSpeed * 0.35 + speed * 0.65;

    const frame = { t, lm, speed: this.smoothSpeed };
    this.frames.push(frame);
    // bewaar ~3 seconden
    while (this.frames.length && t - this.frames[0].t > 3) this.frames.shift();

    return this._detect(frame);
  }

  _detect(frame) {
    const thr = this.opts.speedThreshold;
    if (!this.swing) {
      if (frame.speed > thr && frame.t - this.lastStrokeT > this.opts.minGap) {
        this.swing = { start: frame.t, peak: frame };
      }
      return null;
    }
    if (frame.speed > this.swing.peak.speed) this.swing.peak = frame;
    const ended = frame.speed < thr * 0.55 || frame.t - this.swing.peak.t > 0.35;
    if (!ended) return null;

    const peak = this.swing.peak;
    this.swing = null;
    // te korte of te zwakke uitschieters negeren
    if (peak.speed < thr * 1.15) return null;

    const stroke = this._buildStroke(peak, frame.t);
    if (stroke) {
      this.lastStrokeT = peak.t;
      this.strokes.push(stroke);
    }
    return stroke;
  }

  _window(t0, t1) {
    return this.frames.filter((f) => f.t >= t0 && f.t <= t1);
  }

  _buildStroke(peak, endT) {
    const { wrist, elbow, shoulder, offShoulder } = this.idx;
    const lm = peak.lm;
    const before = this._window(peak.t - 0.9, peak.t);
    const prep = this._window(peak.t - 0.7, peak.t - 0.12);
    const after = this._window(peak.t, endT + 0.4);
    const all = this._window(peak.t - 0.9, endT + 0.4);

    // ---- type slag ----
    const nose = lm[LM.NOSE];
    // Opslag/smash: de pols komt vlak vóór de snelste beweging boven het hoofd uit.
    const lead = this._window(peak.t - 0.45, peak.t + 0.05);
    const isOverhead = lm[wrist].y < nose.y ||
      lead.some((f) => f.lm[wrist].y < f.lm[LM.NOSE].y - 0.1 * this.torsoPx());

    let type;
    let sideScore = 0;
    if (isOverhead) {
      type = 'serve';
    } else {
      // Kant van het lichaam waar de pols zat tijdens de voorbereiding.
      const ref = prep.length ? prep : before;
      for (const f of ref) {
        const L = f.lm[LM.L_SHOULDER];
        const R = f.lm[LM.R_SHOULDER];
        const dir = sub(R, L); // van linker- naar rechterschouder van de speler
        const d2 = dot(dir, dir) || 1;
        const hip = mid(f.lm[LM.L_HIP], f.lm[LM.R_HIP]);
        sideScore += dot(sub(f.lm[wrist], hip), dir) / d2;
      }
      sideScore /= ref.length || 1;
      const domSide = this.opts.rightHanded ? sideScore > 0 : sideScore < 0;
      type = domSide ? 'forehand' : 'backhand';
    }

    // ---- snelheid ----
    const mpp = this.metersPerPx();
    const wristMs = peak.speed * this.torsoPx() * mpp;
    const wristKmh = wristMs * 3.6;
    const racketKmh = wristKmh * this.opts.racketFactor;

    // ---- kniebuiging (minimale kniehoek in de laadfase) ----
    const kneeAngles = before.map((f) =>
      Math.min(
        angle(f.lm[LM.L_HIP], f.lm[LM.L_KNEE], f.lm[LM.L_ANKLE]),
        angle(f.lm[LM.R_HIP], f.lm[LM.R_KNEE], f.lm[LM.R_ANKLE]),
      ),
    );
    const kneeAngle = kneeAngles.length ? Math.min(...kneeAngles) : 180;

    // ---- raakmoment: bij opslag het hoogste polspunt, anders de snelheidspiek ----
    let cf = peak;
    if (type === 'serve') {
      for (const f of lead) if (f.lm[wrist].y < cf.lm[wrist].y) cf = f;
    }
    const c = cf.lm;

    // ---- elleboog bij contact (mediaan rond het raakpunt: minder last van bewegingsonscherpte) ----
    const around = this._window(cf.t - 0.1, cf.t + 0.04)
      .filter((f) => (f.lm[elbow].v ?? 1) > 0.4 && (f.lm[wrist].v ?? 1) > 0.4)
      // alleen meten als boven- en onderarm niet te sterk verkort zijn (arm wijst niet naar de camera)
      .filter((f) => dist(f.lm[shoulder], f.lm[elbow]) > 0.4 * this.torsoPx() &&
        dist(f.lm[elbow], f.lm[wrist]) > 0.35 * this.torsoPx())
      .map((f) => angle(f.lm[shoulder], f.lm[elbow], f.lm[wrist]));
    const elbowAngle = around.length ? median(around) : null; // null = niet meetbaar vanuit deze hoek

    // ---- schouderdraai: hoeveel de schouderbreedte (2D) verandert = rotatie ----
    const widths = all.map((f) => dist(f.lm[LM.L_SHOULDER], f.lm[LM.R_SHOULDER]));
    const maxW = Math.max(...widths);
    const minW = Math.min(...widths);
    const shoulderTurn = maxW ? clamp((1 - minW / maxW) * 100, 0, 100) : 0;
    const angles = all.map((f) => {
      const v = sub(f.lm[LM.R_SHOULDER], f.lm[LM.L_SHOULDER]);
      return (Math.atan2(v.y, v.x) * 180) / Math.PI;
    });
    const tilt = Math.max(...angles) - Math.min(...angles);

    // ---- contacthoogte ----
    const hipY = mid(c[LM.L_HIP], c[LM.R_HIP]).y;
    const kneeY = mid(c[LM.L_KNEE], c[LM.R_KNEE]).y;
    const cShY = mid(c[LM.L_SHOULDER], c[LM.R_SHOULDER]).y;
    const wy = c[wrist].y;
    let contact;
    if (wy < c[LM.NOSE].y) contact = 'boven hoofd';
    else if (wy < cShY) contact = 'schouderhoogte';
    else if (wy < hipY) contact = 'borst-/heuphoogte';
    else if (wy < kneeY) contact = 'laag (heup-knie)';
    else contact = 'zeer laag';

    // ---- uitzwaai: eindigt de pols aan de andere kant, hoog? ----
    let finishHigh = false;
    let finishAcross = false;
    for (const f of after) {
      const w = f.lm[wrist];
      const off = f.lm[offShoulder];
      const own = f.lm[shoulder];
      if (w.y < f.lm[shoulder].y + 0.15 * this.torsoPx()) finishHigh = true;
      // dichter bij andere schouder dan bij eigen schouder
      if (dist(w, off) < dist(w, own)) finishAcross = true;
    }

    const metrics = {
      wristKmh, racketKmh, kneeAngle, elbowAngle, shoulderTurn, tilt, contact, finishHigh, finishAcross,
    };
    const { score, tips, parts } = scoreStroke(type, metrics);

    return {
      id: this.strokes.length + 1,
      t: peak.t,
      contactT: cf.t,
      type,
      label: STROKE_LABELS[type],
      ...metrics,
      score,
      parts,
      tips,
      sideScore,
    };
  }

  summary() {
    return summarize(this.strokes);
  }
}

/** Geeft 0..1 als waarde tussen lo-hi ligt, lineair aflopend daarbuiten. */
function band(v, lo, hi, soft) {
  if (v >= lo && v <= hi) return 1;
  const d = v < lo ? lo - v : v - hi;
  return clamp(1 - d / soft, 0, 1);
}

export function scoreStroke(type, m) {
  const tips = [];
  const parts = {};

  // snelheid (racketkop, geschat)
  const speedTarget = type === 'serve' ? 140 : 110;
  parts.snelheid = clamp(m.racketKmh / speedTarget, 0, 1);

  // knieën: 110-150 graden is een mooie actieve houding
  parts.knieen = band(m.kneeAngle, type === 'serve' ? 100 : 110, 150, 35);
  if (m.kneeAngle > 158) tips.push('Buig je knieën meer in de voorbereiding – kracht komt uit de benen.');
  else if (m.kneeAngle < 95) tips.push('Je zakt erg diep; blijf iets hoger voor een snellere herstelbeweging.');

  // rotatie
  parts.rotatie = clamp((m.shoulderTurn + m.tilt * 0.4) / 45, 0, 1);
  if (parts.rotatie < 0.5) tips.push('Draai je schouders meer in (unit turn) en roteer door bij het raken.');

  // elleboog bij contact
  if (m.elbowAngle == null) {
    // armhoek niet meetbaar vanuit deze camerahoek – telt niet mee
  } else if (type === 'serve') {
    parts.arm = band(m.elbowAngle, 150, 180, 40);
    if (m.elbowAngle < 140) tips.push('Strek je slagarm meer bij het raakpunt van de opslag – raak op het hoogste punt.');
  } else {
    parts.arm = band(m.elbowAngle, 100, 170, 40);
    if (m.elbowAngle < 95) tips.push('Je arm is erg gebogen bij contact – raak de bal verder voor je lichaam.');
  }

  // contacthoogte
  if (type === 'serve') {
    parts.contact = m.contact === 'boven hoofd' ? 1 : 0.4;
  } else {
    parts.contact = { 'borst-/heuphoogte': 1, schouderhoogte: 0.75, 'laag (heup-knie)': 0.6, 'zeer laag': 0.3, 'boven hoofd': 0.4 }[m.contact] ?? 0.5;
    if (m.contact === 'zeer laag' || m.contact === 'laag (heup-knie)') tips.push('Raakpunt is laag: zak door je benen of laat de bal minder ver zakken.');
  }

  // uitzwaai
  parts.uitzwaai = (m.finishHigh ? 0.5 : 0) + (m.finishAcross ? 0.5 : 0);
  if (!m.finishAcross) tips.push('Maak je uitzwaai af over je andere schouder.');
  else if (!m.finishHigh && type !== 'serve') tips.push('Eindig hoger met je uitzwaai voor meer topspin.');

  if (parts.snelheid < 0.5) tips.push('Versnel meer door de bal heen – ontspannen grip, losse arm.');

  const weights = { snelheid: 0.25, knieen: 0.15, rotatie: 0.2, arm: 0.15, contact: 0.1, uitzwaai: 0.15 };
  let score = 0;
  let wsum = 0;
  for (const k in weights) {
    if (parts[k] == null) continue;
    score += parts[k] * weights[k];
    wsum += weights[k];
  }
  score = Math.round((score / (wsum || 1)) * 100);
  if (!tips.length) tips.push('Sterke slag! Houd dit ritme vast.');
  return { score, tips, parts };
}

export function summarize(strokes) {
  const by = { forehand: [], backhand: [], serve: [] };
  for (const s of strokes) by[s.type].push(s);
  const avg = (arr, k) => (arr.length ? arr.reduce((a, s) => a + s[k], 0) / arr.length : 0);
  const out = { total: strokes.length, types: {} };
  for (const k of Object.keys(by)) {
    const arr = by[k];
    out.types[k] = {
      count: arr.length,
      avgSpeed: avg(arr, 'racketKmh'),
      maxSpeed: arr.length ? Math.max(...arr.map((s) => s.racketKmh)) : 0,
      avgScore: avg(arr, 'score'),
    };
  }
  out.avgScore = avg(strokes, 'score');
  out.maxSpeed = strokes.length ? Math.max(...strokes.map((s) => s.racketKmh)) : 0;
  return out;
}

export function toCSV(strokes) {
  const head = ['nr', 'tijd_s', 'slag', 'racket_kmh', 'pols_kmh', 'score', 'kniehoek', 'elleboog', 'schouderdraai_pct', 'contact', 'tips'];
  const rows = strokes.map((s) => [
    s.id, s.t.toFixed(2), s.label, s.racketKmh.toFixed(0), s.wristKmh.toFixed(0), s.score,
    s.kneeAngle.toFixed(0), s.elbowAngle == null ? '' : s.elbowAngle.toFixed(0), s.shoulderTurn.toFixed(0), s.contact,
    `"${s.tips.join(' | ').replace(/"/g, "'")}"`,
  ]);
  return [head, ...rows].map((r) => r.join(',')).join('\n');
}

// node tests/analyzer.test.mjs
import assert from 'node:assert/strict';
import { StrokeAnalyzer, LM, toCSV } from '../js/analyzer.js';

// Speler kijkt naar de camera: rechterschouder van de speler staat links in beeld.
function basePose() {
  const lm = Array.from({ length: 33 }, () => ({ x: 500, y: 400, v: 1 }));
  lm[LM.NOSE] = { x: 500, y: 200 };
  lm[LM.R_SHOULDER] = { x: 450, y: 280 };
  lm[LM.L_SHOULDER] = { x: 550, y: 280 };
  lm[LM.R_ELBOW] = { x: 430, y: 360 };
  lm[LM.L_ELBOW] = { x: 570, y: 360 };
  lm[LM.R_WRIST] = { x: 420, y: 430 };
  lm[LM.L_WRIST] = { x: 580, y: 430 };
  lm[LM.R_HIP] = { x: 470, y: 450 };
  lm[LM.L_HIP] = { x: 530, y: 450 };
  lm[LM.R_KNEE] = { x: 465, y: 560 };
  lm[LM.L_KNEE] = { x: 535, y: 560 };
  lm[LM.R_ANKLE] = { x: 470, y: 670 };
  lm[LM.L_ANKLE] = { x: 530, y: 670 };
  return lm;
}

// Laat de pols een pad volgen: rust -> voorbereiding -> snelle zwaai -> rust
function simulate(an, path, t0 = 0, fps = 30) {
  const out = [];
  let t = t0;
  const push = (w) => {
    const lm = basePose();
    lm[LM.R_WRIST] = w;
    lm[LM.R_ELBOW] = { x: (w.x + 450) / 2, y: (w.y + 280) / 2 + 20 };
    const s = an.addFrame(t, lm);
    if (s) out.push(s);
    t += 1 / fps;
  };
  // rustig terug naar de voorbereidingshouding (vanaf vorige eindpositie)
  const from = an._lastWrist || path.prep;
  for (let i = 1; i <= 25; i++) {
    const k = i / 25;
    push({ x: from.x + (path.prep.x - from.x) * k, y: from.y + (path.prep.y - from.y) * k });
  }
  for (let i = 0; i < 10; i++) push(path.prep);
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    push({ x: path.prep.x + (path.end.x - path.prep.x) * k, y: path.prep.y + (path.end.y - path.prep.y) * k });
  }
  for (let i = 0; i < 25; i++) push(path.end);
  an._lastWrist = path.end;
  return { strokes: out, t };
}

const an = new StrokeAnalyzer({ rightHanded: true, playerHeightM: 1.8 });

let r = simulate(an, { prep: { x: 330, y: 420 }, end: { x: 600, y: 270 } });
assert.equal(r.strokes.length, 1, 'forehand gedetecteerd');
assert.equal(r.strokes[0].type, 'forehand');

r = simulate(an, { prep: { x: 640, y: 420 }, end: { x: 360, y: 280 } }, r.t);
assert.equal(r.strokes.length, 1, 'backhand gedetecteerd');
assert.equal(r.strokes[0].type, 'backhand');

r = simulate(an, { prep: { x: 440, y: 120 }, end: { x: 560, y: 470 } }, r.t);
assert.equal(r.strokes.length, 1, 'opslag gedetecteerd');
assert.equal(r.strokes[0].type, 'serve');

// stilstaan geeft geen slagen
const before = an.strokes.length;
simulate(an, { prep: { x: 420, y: 430 }, end: { x: 425, y: 432 } }, r.t);
assert.equal(an.strokes.length, before, 'geen valse slag bij stilstand');

for (const s of an.strokes) {
  assert.ok(s.racketKmh > 20 && s.racketKmh < 300, `plausibele snelheid ${s.racketKmh}`);
  assert.ok(s.score >= 0 && s.score <= 100);
  console.log(`${s.label.padEnd(15)} ${s.racketKmh.toFixed(0)} km/u  score ${s.score}  ${s.contact}`);
}
const sum = an.summary();
assert.equal(sum.total, 3);
assert.ok(toCSV(an.strokes).split('\n').length === 4);

// linkshandige speler: zelfde forehand-pad gespiegeld met linkerpols
const lefty = new StrokeAnalyzer({ rightHanded: false });
let t = 0;
const path = { prep: { x: 670, y: 420 }, end: { x: 400, y: 270 } };
const frames = [...Array(15).fill(path.prep), ...Array.from({ length: 9 }, (_, i) => ({
  x: path.prep.x + (path.end.x - path.prep.x) * (i / 8), y: path.prep.y + (path.end.y - path.prep.y) * (i / 8),
})), ...Array(25).fill(path.end)];
for (const w of frames) {
  const lm = basePose();
  lm[LM.L_WRIST] = w;
  lefty.addFrame(t, lm);
  t += 1 / 30;
}
assert.equal(lefty.strokes.length, 1);
assert.equal(lefty.strokes[0].type, 'forehand', 'linkshandige forehand');

console.log('Alle tests geslaagd ✔');

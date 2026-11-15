// Usage:
//   node render.js stills <outdir> <frame,frame,...> [samples]
//   node render.js video <out.mp4> [samples] [workers]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const URL = 'file://' + path.resolve(__dirname, 'reel.html');
const TOTAL = 900;

async function page(browser) {
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('console', m => console.log('[page]', m.text()));
  p.on('pageerror', e => { console.error('[pageerror]', e); process.exit(1); });
  await p.goto(URL);
  await p.evaluate(() => window.ready);
  return p;
}

async function stills(dir, frames, samples) {
  fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch();
  const p = await page(b);
  for (const f of frames) {
    const t0 = Date.now();
    const d = await p.evaluate(([f, s]) => window.renderFrame(f, s), [f, samples]);
    fs.writeFileSync(path.join(dir, `f${String(f).padStart(4, '0')}.png`), Buffer.from(d.split(',')[1], 'base64'));
    console.log('frame', f, Date.now() - t0, 'ms');
  }
  await b.close();
}

async function video(outFile, samples, workers) {
  const b = await chromium.launch();
  const per = Math.ceil(TOTAL / workers);
  const segs = [];
  const t0 = Date.now();
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const start = w * per, end = Math.min(TOTAL, start + per);
    const seg = `${outFile}.seg${w}.mp4`; segs[w] = seg;
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'png', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '8', '-pix_fmt', 'yuv444p', '-g', '60', seg], { stdio: ['pipe', 'inherit', 'inherit'] });
    const p = await page(b);
    for (let f = start; f < end; f++) {
      const d = await p.evaluate(([f, s]) => window.renderFrame(f, s), [f, samples]);
      const buf = Buffer.from(d.split(',')[1], 'base64');
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if ((f - start) % 30 === 0) console.log(`w${w} frame ${f} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
  }));
  await b.close();
  fs.writeFileSync(outFile + '.txt', segs.map(s => `file '${path.resolve(s)}'`).join('\n'));
  console.log('rendered in', ((Date.now() - t0) / 1000).toFixed(1), 's');
}

const [mode, a, b, c] = process.argv.slice(2);
if (mode === 'stills') stills(a, b.split(',').map(Number), +(c || 1));
else video(a, +(b || 4), +(c || 4));

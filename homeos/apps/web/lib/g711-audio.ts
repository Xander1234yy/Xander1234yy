/**
 * Geluid van een Tapo-camera uit de live MPEG-TS-stroom: de camera stuurt G.711 (A-law of µ-law, meestal 8 kHz mono)
 * als privé-audiospoor, dat browsers niet zelf afspelen. Dit haalt het spoor eruit (PES met stream-id 0xC0–0xDF),
 * zet het om naar PCM en speelt het af via Web Audio. Puur en zonder afhankelijkheden, zodat het te testen is.
 */

export type G711 = "alaw" | "mulaw";

export function alawToPcm(a: number): number {
  a ^= 0x55;
  let t = (a & 0x0f) << 4;
  const seg = (a & 0x70) >> 4;
  if (seg === 0) t += 8;
  else if (seg === 1) t += 0x108;
  else t = (t + 0x108) << (seg - 1);
  return a & 0x80 ? t : -t;
}

export function mulawToPcm(u: number): number {
  u = ~u & 0xff;
  let t = ((u & 0x0f) << 3) + 0x84;
  t <<= (u & 0x70) >> 4;
  return u & 0x80 ? 0x84 - t : t - 0x84;
}

export function decodeG711(data: Uint8Array, codec: G711): Float32Array {
  const out = new Float32Array(data.length);
  const f = codec === "alaw" ? alawToPcm : mulawToPcm;
  for (let i = 0; i < data.length; i++) out[i] = f(data[i]!) / 32768;
  return out;
}

/** Haalt audio-PES-inhoud uit MPEG-TS-pakketten (188 bytes), ook als pakketten over stukken verdeeld binnenkomen. */
export class TsAudioDemuxer {
  private rest = new Uint8Array(0);
  private pid: number | null = null;
  private pes: Uint8Array[] = [];

  constructor(private readonly onPayload: (payload: Uint8Array) => void) {}

  push(chunk: Uint8Array) {
    const buf = this.rest.length ? concat([this.rest, chunk]) : chunk;
    let i = 0;
    while (buf.length - i >= 188) {
      if (buf[i] !== 0x47) {
        i++;
        continue;
      }
      this.packet(buf.subarray(i, i + 188));
      i += 188;
    }
    this.rest = buf.slice(i);
  }

  private packet(p: Uint8Array) {
    const pid = ((p[1]! & 0x1f) << 8) | p[2]!;
    const start = (p[1]! & 0x40) !== 0;
    const adapt = (p[3]! >> 4) & 0x3;
    let off = 4;
    if (adapt & 0x2) off += 1 + p[4]!;
    if (!(adapt & 0x1) || off >= 188) return;
    const body = p.subarray(off);
    if (this.pid === null) {
      if (start && body.length >= 4 && body[0] === 0 && body[1] === 0 && body[2] === 1 && body[3]! >= 0xc0 && body[3]! <= 0xdf) this.pid = pid;
      else return;
    }
    if (pid !== this.pid) return;
    if (start) this.flush();
    this.pes.push(body.slice());
  }

  flush() {
    if (!this.pes.length) return;
    const pes = concat(this.pes);
    this.pes = [];
    if (pes.length < 9 || pes[0] !== 0 || pes[1] !== 0 || pes[2] !== 1) return;
    const payload = pes.subarray(9 + pes[8]!);
    if (payload.length) this.onPayload(payload);
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Speelt PCM-blokken achter elkaar af met een kleine buffer (±0,3 s); loopt het te ver uit, dan wordt bijgesprongen. */
export class PcmPlayer {
  private next = 0;
  constructor(
    private readonly ctx: AudioContext,
    private readonly rate: number,
  ) {}

  play(samples: Float32Array) {
    if (!samples.length) return;
    const buf = this.ctx.createBuffer(1, samples.length, this.rate);
    buf.getChannelData(0).set(samples);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    if (this.next < now + 0.05 || this.next > now + 1.5) this.next = now + 0.3;
    src.start(this.next);
    this.next += buf.duration;
  }
}

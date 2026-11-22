/**
 * Kleurconversies voor Philips Hue (CIE 1931 xy), volgens de formules uit de Hue-ontwikkelaarsdocumentatie
 * ("RGB to xy Color conversion"): sRGB-gammacorrectie → Wide RGB D65 → XYZ → xy, geclamped binnen het gamut.
 */
export interface XY {
  x: number;
  y: number;
}
export interface Gamut {
  red: XY;
  green: XY;
  blue: XY;
}

/** Gamut C (moderne Hue-kleurenlampen) als standaard. */
export const GAMUT_C: Gamut = { red: { x: 0.6915, y: 0.3083 }, green: { x: 0.17, y: 0.7 }, blue: { x: 0.1532, y: 0.0475 } };

const gamma = (c: number) => (c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92);
const invGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function cross(a: XY, b: XY) {
  return a.x * b.y - a.y * b.x;
}

function inGamut(p: XY, g: Gamut): boolean {
  const v1 = { x: g.green.x - g.red.x, y: g.green.y - g.red.y };
  const v2 = { x: g.blue.x - g.red.x, y: g.blue.y - g.red.y };
  const q = { x: p.x - g.red.x, y: p.y - g.red.y };
  const s = cross(q, v2) / cross(v1, v2);
  const t = cross(v1, q) / cross(v1, v2);
  return s >= 0 && t >= 0 && s + t <= 1;
}

function closestOnLine(a: XY, b: XY, p: XY): XY {
  const ap = { x: p.x - a.x, y: p.y - a.y };
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const t = Math.min(1, Math.max(0, (ap.x * ab.x + ap.y * ab.y) / (ab.x * ab.x + ab.y * ab.y)));
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

function clampToGamut(p: XY, g: Gamut): XY {
  if (inGamut(p, g)) return p;
  const candidates = [closestOnLine(g.red, g.green, p), closestOnLine(g.blue, g.red, p), closestOnLine(g.green, g.blue, p)];
  const d = (q: XY) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  return candidates.reduce((best, c) => (d(c) < d(best) ? c : best));
}

export function hexToXy(hex: string, gamut: Gamut = GAMUT_C): XY {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = gamma(((n >> 16) & 255) / 255);
  const g = gamma(((n >> 8) & 255) / 255);
  const b = gamma((n & 255) / 255);
  const X = r * 0.664511 + g * 0.154324 + b * 0.162028;
  const Y = r * 0.283881 + g * 0.668433 + b * 0.047685;
  const Z = r * 0.000088 + g * 0.07231 + b * 0.986039;
  const sum = X + Y + Z;
  if (sum === 0) return { x: 0.3127, y: 0.329 }; // zwart → wit punt (D65)
  const p = clampToGamut({ x: X / sum, y: Y / sum }, gamut);
  return { x: Math.round(p.x * 10000) / 10000, y: Math.round(p.y * 10000) / 10000 };
}

/** Benaderde weergavekleur voor de UI (helderheid genormaliseerd). */
export function xyToHex({ x, y }: XY): string {
  const Y = 1;
  const X = (Y / y) * x;
  const Z = (Y / y) * (1 - x - y);
  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.01153;
  const max = Math.max(r, g, b, 1e-6);
  r = invGamma(Math.max(0, r / max));
  g = invGamma(Math.max(0, g / max));
  b = invGamma(Math.max(0, b / max));
  const to = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export const kelvinToMirek = (k: number) => Math.round(1_000_000 / k);
export const mirekToKelvin = (m: number) => Math.round(1_000_000 / m);

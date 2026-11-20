/** Tekstverwerking voor Nederlandse opdrachten. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^a-z0-9%.\s]/g, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const has = (msg: string, ...terms: string[]) => terms.some((t) => new RegExp(`(^|\\s)${t}`).test(msg));
export const hasWord = (msg: string, ...words: string[]) => words.some((w) => new RegExp(`(^|\\s)${w}($|\\s)`).test(msg));

const UNITS: Record<string, number> = {
  een: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10, elf: 11, twaalf: 12,
  dertien: 13, veertien: 14, vijftien: 15, zestien: 16, zeventien: 17, achttien: 18, negentien: 19,
};
const TENS: Record<string, number> = { twintig: 20, dertig: 30, veertig: 40, vijftig: 50, zestig: 60, zeventig: 70, tachtig: 80, negentig: 90 };

/** Zet getallen in woorden om naar cijfers: "eenentwintig" → 21, "honderd" → 100, "half" → .5 na een getal. */
export function wordsToNumbers(s: string): string {
  return s
    .replace(/\bhonderd\b/g, "100")
    .replace(/\b(een|twee|drie|vier|vijf|zes|zeven|acht|negen)en(twintig|dertig|veertig|vijftig|zestig|zeventig|tachtig|negentig)\b/g, (_, u: string, t: string) => String(UNITS[u]! + TENS[t]!))
    .replace(/\b(twintig|dertig|veertig|vijftig|zestig|zeventig|tachtig|negentig)\b/g, (t: string) => String(TENS[t]))
    .replace(/\b(dertien|veertien|vijftien|zestien|zeventien|achttien|negentien|tien|elf|twaalf|twee|drie|vier|vijf|zes|zeven|acht|negen)\b/g, (u: string) => String(UNITS[u]))
    .replace(/(\d+) en een half\b/g, (_, n: string) => `${n}.5`)
    .replace(/(\d+) half\b/g, (_, n: string) => `${n}.5`);
}

/** Damerau-Levenshtein-afstand (OSA): tikfouten inclusief verwisselde letters ("lmap" → "lamp"). */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[m]![n]!;
}

export const COLORS: Record<string, string> = {
  rood: "#ff2a2a", oranje: "#ff8a3d", geel: "#ffd23f", groen: "#34d399", blauw: "#3a5bff", lichtblauw: "#38bdf8",
  paars: "#a855f7", roze: "#ff5d9e", wit: "#fff4e5", warmwit: "#ffd8a8", turquoise: "#2dd4bf", magenta: "#ff2ad4",
};

export function fmtNum(n: number, digits = 1) {
  return n.toLocaleString("nl-NL", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

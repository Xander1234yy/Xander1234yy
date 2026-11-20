"use client";

import { useId, useMemo, useState } from "react";
import type { EnergyHistory } from "@homeos/shared";

interface Series {
  key: "productionKwh" | "consumptionKwh" | "importKwh" | "exportKwh";
  label: string;
  color: string;
}

const DEFAULT_SERIES: Series[] = [
  { key: "productionKwh", label: "Opwek", color: "var(--color-solar)" },
  { key: "consumptionKwh", label: "Verbruik", color: "var(--color-accent)" },
];

function labelFor(t: string, bucket: EnergyHistory["bucket"]) {
  const d = new Date(t);
  if (bucket === "15m" || bucket === "hour") return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  if (bucket === "month") return d.toLocaleDateString("nl-NL", { month: "short" });
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

/**
 * Lichtgewicht SVG-grafiek: vlakken voor dag-historie (15 min), staven voor week/maand/jaar.
 * Waarden in kWh per bucket; voor 15-minuten wordt dit omgerekend naar gemiddeld vermogen (kW).
 */
export function EnergyChart({ history, series = DEFAULT_SERIES, height = 220 }: { history: EnergyHistory; series?: Series[]; height?: number }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const W = 800;
  const H = height;
  const pad = { l: 40, r: 12, t: 12, b: 26 };
  const isArea = history.bucket === "15m";
  const factor = isArea ? 4 : 1; // kWh per kwartier → kW
  const unit = isArea ? "kW" : "kWh";
  const pts = history.points;

  const max = useMemo(() => {
    let m = 0;
    for (const p of pts) for (const s of series) m = Math.max(m, (p[s.key] ?? 0) * factor);
    return m > 0 ? m * 1.12 : 1;
  }, [pts, series, factor]);

  if (!pts.length) return <p className="py-10 text-center text-sm text-muted">Nog geen gegevens voor deze periode.</p>;

  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slots = isArea ? 96 : pts.length;
  const x = (i: number) => pad.l + (isArea ? (i / (slots - 1)) * iw : ((i + 0.5) / slots) * iw);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.ceil(pts.length / (isArea ? 6 : 8));
  const hp = hover != null ? pts[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Energiegrafiek in ${unit}`} onMouseLeave={() => setHover(null)}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity="0.45" />
              <stop offset="1" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.05)" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--color-muted)">
              {t.toFixed(t < 10 ? 1 : 0)}
            </text>
          </g>
        ))}
        {isArea
          ? series.map((s) => {
              const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y((p[s.key] ?? 0) * factor).toFixed(1)}`).join("");
              const area = `${line}L${x(pts.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
              return (
                <g key={s.key}>
                  <path d={area} fill={`url(#${id}-${s.key})`} />
                  <path d={line} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
                </g>
              );
            })
          : pts.map((p, i) => {
              const bw = Math.min(28, (iw / slots) * 0.7) / series.length;
              return series.map((s, j) => {
                const v = (p[s.key] ?? 0) * factor;
                const bx = x(i) - (bw * series.length) / 2 + j * bw;
                return <rect key={s.key + i} x={bx} y={y(v)} width={Math.max(1, bw - 2)} height={Math.max(0, y(0) - y(v))} rx="3" fill={s.color} opacity={hover == null || hover === i ? 0.9 : 0.35} />;
              });
            })}
        {pts.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.t} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-muted)">
              {labelFor(p.t, history.bucket)}
            </text>
          ) : null,
        )}
        {hover != null && isArea && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" />}
        {pts.map((p, i) => (
          <rect
            key={`h${p.t}`}
            x={x(i) - iw / slots / 2}
            y={pad.t}
            width={iw / slots}
            height={ih}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onTouchStart={() => setHover(i)}
          />
        ))}
      </svg>
      {hp && (
        <div className="pointer-events-none absolute right-2 top-0 rounded-xl border border-white/10 bg-navy-850/95 px-3 py-2 text-xs shadow-xl">
          <p className="mb-1 text-muted">{labelFor(hp.t, history.bucket)}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center gap-2 tabular">
              <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}: {((hp[s.key] ?? 0) * factor).toLocaleString("nl-NL", { maximumFractionDigits: 2 })} {unit}
            </p>
          ))}
        </div>
      )}
      <div className="mt-2 flex gap-4 text-xs text-muted">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label} ({unit})
          </span>
        ))}
      </div>
    </div>
  );
}

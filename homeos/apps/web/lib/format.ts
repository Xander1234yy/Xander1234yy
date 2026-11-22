const nl = "nl-NL";

export function formatW(w: number | null | undefined): string {
  if (w == null) return "—";
  const abs = Math.abs(w);
  if (abs >= 1000) return `${(w / 1000).toLocaleString(nl, { maximumFractionDigits: 2, minimumFractionDigits: 1 })} kW`;
  return `${Math.round(w).toLocaleString(nl)} W`;
}

export function formatKwh(kwh: number | null | undefined, digits = 1): string {
  if (kwh == null) return "—";
  return `${kwh.toLocaleString(nl, { maximumFractionDigits: digits, minimumFractionDigits: digits })} kWh`;
}

export function formatEuro(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString(nl, { style: "currency", currency: "EUR" });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(nl, { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "nooit";
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `vandaag ${formatTime(iso)}`
    : d.toLocaleString(nl, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "nooit";
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 10) return "zojuist";
  if (s < 60) return `${s} s geleden`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min geleden`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} uur geleden`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "dag" : "dagen"} geleden`;
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 6) return "Goedenacht";
  if (h < 12) return "Goedemorgen";
  if (h < 18) return "Goedemiddag";
  return "Goedenavond";
}

export function longDate(date = new Date()): string {
  return date.toLocaleDateString(nl, { weekday: "long", day: "numeric", month: "long" });
}

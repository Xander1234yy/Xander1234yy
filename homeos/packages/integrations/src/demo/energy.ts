import type { DeviceCommand, EnergyHistory, EnergyPeriod, EnergyPoint, EnergyRange, EnergySummary } from "@homeos/shared";
import type { DeviceAdapter, EnergyProvider } from "../adapter";
import { DemoAdapterBase, demoDevice, type DemoDevice } from "./base";
import { hashString, seeded } from "./random";

const BUCKET_MS = 15 * 60_000;
const PEAK_W = 4800; // ~5 kWp demo-installatie

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000);
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Gesimuleerde zonne-opwek (W) op tijdstip t. Deterministisch per dag. */
export function demoSolarW(t: Date): number {
  const doy = dayOfYear(t);
  const season = Math.sin((2 * Math.PI * (doy - 80)) / 365); // -1 winter .. 1 zomer
  const daylen = 12 + 4.3 * season;
  const noon = 13.2;
  const h = t.getHours() + t.getMinutes() / 60;
  const x = (h - (noon - daylen / 2)) / daylen;
  if (x <= 0 || x >= 1) return 0;
  const rnd = seeded(hashString(dayKey(t)));
  const cloudiness = rnd();
  const phase = rnd() * Math.PI * 2;
  const peak = PEAK_W * (0.25 + 0.75 * ((season + 1) / 2));
  const clouds = (1 - 0.65 * cloudiness) * (1 - 0.3 * cloudiness * (0.5 + 0.5 * Math.sin(h * 2.1 + phase)));
  return Math.max(0, peak * Math.pow(Math.sin(Math.PI * x), 1.3) * clouds);
}

/** Gesimuleerd huishoudelijk verbruik (W). */
export function demoConsumptionW(t: Date): number {
  const h = t.getHours() + t.getMinutes() / 60;
  const g = (mu: number, sigma: number, amp: number) => amp * Math.exp(-((h - mu) ** 2) / (2 * sigma ** 2));
  const slot = Math.floor(t.getTime() / BUCKET_MS);
  const noise = seeded(slot)() * 220;
  return 260 + g(7.8, 0.8, 650) + g(12.5, 1, 250) + g(18.5, 1.6, 1100) + g(21.5, 1, 400) + noise;
}

interface Bucket {
  start: Date;
  productionKwh: number;
  consumptionKwh: number;
  importKwh: number;
  exportKwh: number;
}

function bucketAt(start: Date, fraction = 1): Bucket {
  const mid = new Date(start.getTime() + (BUCKET_MS * fraction) / 2);
  const p = demoSolarW(mid);
  const c = demoConsumptionW(mid);
  const hours = (0.25 * fraction);
  const net = c - p;
  return {
    start,
    productionKwh: (p * hours) / 1000,
    consumptionKwh: (c * hours) / 1000,
    importKwh: (Math.max(0, net) * hours) / 1000,
    exportKwh: (Math.max(0, -net) * hours) / 1000,
  };
}

function emptyTotals(): Required<{ [K in keyof EnergyPeriod]: number }> {
  return { productionKwh: 0, consumptionKwh: 0, importKwh: 0, exportKwh: 0 };
}

function addBucket(t: ReturnType<typeof emptyTotals>, b: Bucket | ReturnType<typeof emptyTotals>) {
  t.productionKwh += b.productionKwh;
  t.consumptionKwh += b.consumptionKwh;
  t.importKwh += b.importKwh;
  t.exportKwh += b.exportKwh;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
function rounded(t: ReturnType<typeof emptyTotals>): EnergyPeriod {
  return { productionKwh: r3(t.productionKwh), consumptionKwh: r3(t.consumptionKwh), importKwh: r3(t.importKwh), exportKwh: r3(t.exportKwh) };
}

/** Pure demo-energiemodel; gescheiden van de adapter zodat het los te testen is. */
export class DemoEnergyModel {
  private dayCache = new Map<string, ReturnType<typeof emptyTotals>>();

  bucketsUntil(dayStart: Date, until: Date): Bucket[] {
    const out: Bucket[] = [];
    for (let t = dayStart.getTime(); t < until.getTime(); t += BUCKET_MS) {
      const fraction = Math.min(1, (until.getTime() - t) / BUCKET_MS);
      out.push(bucketAt(new Date(t), fraction));
    }
    return out;
  }

  fullDay(day: Date): ReturnType<typeof emptyTotals> {
    const key = dayKey(day);
    const cached = this.dayCache.get(key);
    if (cached) return cached;
    const start = startOfDay(day);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    const totals = emptyTotals();
    for (const b of this.bucketsUntil(start, end)) addBucket(totals, b);
    this.dayCache.set(key, totals);
    return totals;
  }

  totalsBetween(from: Date, now: Date): ReturnType<typeof emptyTotals> {
    const totals = emptyTotals();
    const today = startOfDay(now);
    for (let d = startOfDay(from); d < today; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      addBucket(totals, this.fullDay(d));
    }
    for (const b of this.bucketsUntil(today, now)) addBucket(totals, b);
    return totals;
  }

  summary(now: Date, sourceId: string): EnergySummary {
    const p = demoSolarW(now);
    const c = demoConsumptionW(now);
    return {
      sourceId,
      demo: true,
      updatedAt: now.toISOString(),
      currentProductionW: Math.round(p),
      currentConsumptionW: Math.round(c),
      gridImportW: Math.round(Math.max(0, c - p)),
      gridExportW: Math.round(Math.max(0, p - c)),
      today: rounded(this.totalsBetween(startOfDay(now), now)),
      month: rounded(this.totalsBetween(new Date(now.getFullYear(), now.getMonth(), 1), now)),
      year: rounded(this.totalsBetween(new Date(now.getFullYear(), 0, 1), now)),
    };
  }

  history(now: Date, range: EnergyRange, sourceId: string): EnergyHistory {
    const point = (t: Date, x: ReturnType<typeof emptyTotals>): EnergyPoint => ({ t: t.toISOString(), ...rounded(x) });
    const today = startOfDay(now);
    let points: EnergyPoint[] = [];
    let bucket: EnergyHistory["bucket"] = "day";
    if (range === "day") {
      bucket = "15m";
      points = this.bucketsUntil(today, now).map((b) => point(b.start, b));
    } else if (range === "week" || range === "month") {
      const days = range === "week" ? 7 : 30;
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
        points.push(point(d, i === 0 ? this.totalsBetween(d, now) : this.fullDay(d)));
      }
    } else {
      bucket = "month";
      for (let m = 0; m <= now.getMonth(); m++) {
        const from = new Date(now.getFullYear(), m, 1);
        const to = m === now.getMonth() ? now : new Date(now.getFullYear(), m + 1, 1);
        const totals = emptyTotals();
        for (let d = from; d < to && d < today; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
          addBucket(totals, this.fullDay(d));
        }
        if (m === now.getMonth()) for (const b of this.bucketsUntil(today, now)) addBucket(totals, b);
        points.push(point(from, totals));
      }
    }
    return { sourceId, demo: true, range, bucket, points };
  }
}

/** DEMO omvormer + slimme meter. */
export class DemoEnergyAdapter extends DemoAdapterBase {
  readonly id = "demo-energy";
  readonly integration: DeviceAdapter["integration"] = "demo";
  readonly displayName = "Demo-energie (zonnepanelen + slimme meter)";
  protected override tickMs = 10_000;
  private readonly model = new DemoEnergyModel();

  readonly energy: EnergyProvider = {
    getSummary: async () => this.model.summary(this.now(), this.id),
    getHistory: async (range) => this.model.history(this.now(), range, this.id),
  };

  private now(): Date {
    return this.ctx?.now() ?? new Date();
  }

  protected seed(): DemoDevice[] {
    return [
      demoDevice({ externalId: "omvormer", name: "Zonnepanelen", model: "Demo omvormer 5 kWp", kind: "solar_inverter", capabilities: ["energy_production"], suggestedRoomId: "overig" }, {}),
      demoDevice({ externalId: "slimme-meter", name: "Slimme meter", model: "Demo P1-meter", kind: "energy_meter", capabilities: ["energy_grid"], suggestedRoomId: "overig" }, {}),
    ];
  }

  override async connect(...args: Parameters<DemoAdapterBase["connect"]>): Promise<void> {
    await super.connect(...args);
    this.refresh(false);
  }

  protected apply(_d: DemoDevice, _c: DeviceCommand): void {
    // Energieapparaten zijn alleen-lezen.
  }

  protected override tick(): void {
    this.refresh(true);
  }

  private refresh(emit: boolean): void {
    const s = this.model.summary(this.now(), this.id);
    const inv = this.devices.get("omvormer");
    const meter = this.devices.get("slimme-meter");
    if (inv) {
      inv.state = { productionW: s.currentProductionW ?? 0, energyTodayKwh: s.today.productionKwh ?? 0 };
      if (emit) this.push(inv);
    }
    if (meter) {
      meter.state = { powerW: (s.gridImportW ?? 0) - (s.gridExportW ?? 0), energyTodayKwh: s.today.importKwh ?? 0 };
      if (emit) this.push(meter);
    }
  }
}

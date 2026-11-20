import type { AdapterHealth, Capability, DeviceCommand, EnergyHistory, EnergyPoint, EnergyRange, EnergySummary } from "@homeos/shared";
import type { AdapterContext, CommandResult, DeviceAdapter, DiscoveredDevice, EnergyProvider, StatusReport } from "../adapter";
import { CloudApiError, dateInZone, RequestBudget, zonedToIso } from "../cloud/budget";

/**
 * SolarEdge via de officiële Monitoring API (v1): https://monitoringapi.solaredge.com
 * - Site-API-key (Monitoring-portal → Admin → Site Access), versleuteld in de connector.
 * - Daglimiet 300 verzoeken per site: HomeOS gebruikt er maximaal 280 en plant ververs-momenten.
 * - Zonder SolarEdge-energiemeter levert de API alleen opwek; verbruik/afname/teruglevering zijn dan null.
 */
const BASE = "https://monitoringapi.solaredge.com";
const OVERVIEW_EVERY_MS = 10 * 60_000; // ± 144 per dag
const TODAY_HISTORY_EVERY_MS = 30 * 60_000; // ± 48 per dag
const LONG_HISTORY_EVERY_MS = 6 * 3600_000; // week/maand/jaar: ± 12 per dag

export interface SolarEdgeConfig {
  siteId: string;
  name: string;
  timeZone: string;
  peakPowerKw: number | null;
}

interface Overview {
  overview: {
    lastUpdateTime: string;
    lifeTimeData: { energy: number };
    lastYearData: { energy: number };
    lastMonthData: { energy: number };
    lastDayData: { energy: number };
    currentPower: { power: number };
  };
}
interface EnergyResponse {
  energy: { timeUnit: string; unit: string; values: { date: string; value: number | null }[] };
}
export interface SiteDetails {
  details: { id: number; name: string; status: string; peakPower: number; location: { timeZone: string } };
}

type Fetch = typeof fetch;

async function seGet<T>(fetchImpl: Fetch, path: string, apiKey: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", apiKey);
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new CloudApiError("SolarEdge is niet bereikbaar", "network");
  }
  if (res.status === 401 || res.status === 403) throw new CloudApiError("SolarEdge weigert de API-key (controleer site-ID en key)", "auth");
  if (res.status === 429) throw new CloudApiError("SolarEdge-daglimiet bereikt", "rate_limited");
  if (!res.ok) throw new CloudApiError(`SolarEdge gaf status ${res.status}`, "server");
  return (await res.json()) as T;
}

/** Controleert site-ID + key en haalt naam/tijdzone op (1 verzoek). */
export async function validateSolarEdge(siteId: string, apiKey: string, fetchImpl: Fetch = fetch): Promise<SolarEdgeConfig> {
  if (!/^\d{1,12}$/.test(siteId)) throw new CloudApiError("Site-ID bestaat alleen uit cijfers", "invalid");
  if (!/^[A-Za-z0-9]{16,64}$/.test(apiKey)) throw new CloudApiError("De API-key heeft een onverwacht formaat", "invalid");
  const d = await seGet<SiteDetails>(fetchImpl, `/site/${siteId}/details`, apiKey);
  return { siteId, name: d.details.name, timeZone: d.details.location.timeZone || "Europe/Amsterdam", peakPowerKw: d.details.peakPower ?? null };
}

const kwh = (wh: number | null | undefined) => (wh == null ? null : Math.round(wh) / 1000);

export class SolarEdgeAdapter implements DeviceAdapter {
  readonly integration = "solar" as const;
  readonly demo = false;
  readonly id: string;
  readonly displayName: string;

  private ctx: AdapterContext | null = null;
  private apiKey: string | null = null;
  private overview: Overview["overview"] | null = null;
  private overviewAt = 0;
  private lastError: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private history = new Map<EnergyRange, { at: number; data: EnergyHistory }>();
  readonly budget: RequestBudget;

  constructor(
    readonly config: SolarEdgeConfig,
    private readonly fetchImpl: Fetch = fetch,
    now: () => number = Date.now,
  ) {
    this.id = `solaredge-${config.siteId}`;
    this.displayName = `SolarEdge (${config.name})`;
    this.budget = new RequestBudget(280, 0, now);
    this.nowMs = now;
  }
  private readonly nowMs: () => number;

  readonly energy: EnergyProvider = {
    role: "production",
    getSummary: () => this.summary(),
    getHistory: (range) => this.getHistory(range),
  };

  async connect(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    this.apiKey = await ctx.secrets.get("apiKey");
    if (!this.apiKey) {
      this.lastError = "Geen API-key opgeslagen";
      return;
    }
    if (ctx.serverless) {
      await this.restore();
      await this.refreshOverview();
      return;
    }
    await this.refreshOverview();
    this.timer = setInterval(() => void this.refreshOverview(), 60_000);
    this.timer.unref?.();
  }

  private async restore() {
    const c = (await this.ctx?.cache?.load()) as { overview?: Overview["overview"]; overviewAt?: number; history?: [EnergyRange, { at: number; data: EnergyHistory }][]; budget?: unknown } | null;
    if (!c) return;
    if (c.overview) this.overview = c.overview;
    if (typeof c.overviewAt === "number") this.overviewAt = c.overviewAt;
    if (Array.isArray(c.history)) this.history = new Map(c.history);
    this.budget.importState(c.budget);
  }

  private async persist() {
    if (!this.ctx?.serverless) return;
    await this.ctx.cache?.save({ overview: this.overview, overviewAt: this.overviewAt, history: [...this.history], budget: this.budget.exportState() });
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.ctx = null;
  }

  private async call<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    if (!this.apiKey) throw new CloudApiError("Geen API-key", "auth");
    if (!this.budget.canSpend("background")) throw new CloudApiError("Daglimiet van SolarEdge (bijna) bereikt; gegevens worden later ververst", "budget");
    this.budget.spend();
    try {
      return await seGet<T>(this.fetchImpl, path, this.apiKey, params);
    } catch (err) {
      if (err instanceof CloudApiError && err.kind === "rate_limited") this.budget.blockFor(3600);
      throw err;
    }
  }

  /** Haalt het overzicht op als het ouder is dan het interval (aangeroepen door een minuuttimer). */
  async refreshOverview(force = false): Promise<void> {
    if (!force && this.overview && this.nowMs() - this.overviewAt < OVERVIEW_EVERY_MS) return;
    try {
      const r = await this.call<Overview>(`/site/${this.config.siteId}/overview`);
      this.overview = r.overview;
      this.overviewAt = this.nowMs();
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.ctx?.logger.warn("SolarEdge verversen mislukt", { error: this.lastError });
    }
    this.ctx?.emit({ type: "device_state", externalId: "site", report: this.report() });
    await this.persist();
  }

  private measuredAt(): string | null {
    if (!this.overview?.lastUpdateTime) return null;
    try {
      return zonedToIso(this.overview.lastUpdateTime, this.config.timeZone);
    } catch {
      return null;
    }
  }

  private report(): StatusReport {
    if (!this.overview) return { status: this.lastError ? "ERROR" : "CONNECTING", state: {}, lastSeen: null, error: this.lastError };
    const state = { productionW: Math.max(0, Math.round(this.overview.currentPower.power)), energyTodayKwh: kwh(this.overview.lastDayData.energy) ?? 0 };
    // Bij een tijdelijke fout (bijv. budget) blijven de laatste meetwaarden staan, met hun eigen meettijd.
    return { status: "ONLINE", state, lastSeen: this.measuredAt(), error: this.lastError, stateAt: this.measuredAt() };
  }

  async discover(): Promise<DiscoveredDevice[]> {
    return [
      {
        externalId: "site",
        name: `Zonnepanelen ${this.config.name}`.slice(0, 80),
        brand: "SolarEdge",
        model: this.config.peakPowerKw ? `Installatie ${this.config.peakPowerKw} kWp` : "Installatie",
        kind: "solar_inverter",
        capabilities: ["energy_production"],
        suggestedRoomId: "overig",
        refreshIntervalMs: OVERVIEW_EVERY_MS,
      },
    ];
  }

  async getStatus(): Promise<StatusReport> {
    return this.report();
  }

  async executeCommand(_id: string, _c: DeviceCommand): Promise<CommandResult> {
    return { ok: false, code: "UNSUPPORTED", message: "Zonnepanelen zijn alleen-lezen" };
  }

  getCapabilities(): Capability[] {
    return ["energy_production"];
  }

  async healthCheck(): Promise<AdapterHealth> {
    return {
      adapterId: this.id,
      integration: this.integration,
      displayName: this.displayName,
      demo: false,
      status: !this.apiKey ? "not_configured" : this.lastError && !this.overview ? "down" : this.lastError ? "degraded" : "ok",
      message: `${this.lastError ?? "Verbonden"} · ${this.budget.remaining()} van 280 verzoeken over vandaag`,
      checkedAt: new Date(this.nowMs()).toISOString(),
    };
  }

  // ───────────── energie ─────────────

  private async summary(): Promise<EnergySummary> {
    const o = this.overview;
    if (!o) throw new CloudApiError(this.lastError ?? "Nog geen SolarEdge-gegevens", "server");
    const period = (wh: number) => ({ productionKwh: kwh(wh), consumptionKwh: null, importKwh: null, exportKwh: null });
    return {
      sourceId: this.id,
      demo: false,
      updatedAt: this.measuredAt() ?? new Date(this.overviewAt).toISOString(),
      currentProductionW: Math.max(0, Math.round(o.currentPower.power)),
      // Zonder SolarEdge-energiemeter is er geen verbruiks- of netmeting: eerlijk null, nooit geschat.
      currentConsumptionW: null,
      gridImportW: null,
      gridExportW: null,
      today: period(o.lastDayData.energy),
      month: period(o.lastMonthData.energy),
      year: period(o.lastYearData.energy),
    };
  }

  private async getHistory(range: EnergyRange): Promise<EnergyHistory> {
    const cached = this.history.get(range);
    const maxAge = range === "day" ? TODAY_HISTORY_EVERY_MS : LONG_HISTORY_EVERY_MS;
    if (cached && this.nowMs() - cached.at < maxAge) return cached.data;
    try {
      const data = await this.fetchHistory(range);
      this.history.set(range, { at: this.nowMs(), data });
      await this.persist();
      return data;
    } catch (err) {
      if (cached) return cached.data; // liever oudere historie (met eigen tijden) dan niets
      throw err;
    }
  }

  private async fetchHistory(range: EnergyRange): Promise<EnergyHistory> {
    const tz = this.config.timeZone;
    const now = new Date(this.nowMs());
    const today = dateInZone(now, tz);
    const shift = (days: number) => dateInZone(new Date(now.getTime() - days * 86_400_000), tz);
    const spec: Record<EnergyRange, { timeUnit: string; start: string; bucket: EnergyHistory["bucket"] }> = {
      day: { timeUnit: "QUARTER_OF_AN_HOUR", start: today, bucket: "15m" },
      week: { timeUnit: "DAY", start: shift(6), bucket: "day" },
      month: { timeUnit: "DAY", start: shift(29), bucket: "day" },
      year: { timeUnit: "MONTH", start: `${today.slice(0, 4)}-01-01`, bucket: "month" },
    };
    const s = spec[range];
    const r = await this.call<EnergyResponse>(`/site/${this.config.siteId}/energy`, { timeUnit: s.timeUnit, startDate: s.start, endDate: today });
    const factor = r.energy.unit === "kWh" ? 1 : r.energy.unit === "MWh" ? 1000 : 0.001; // standaard Wh
    const points: EnergyPoint[] = r.energy.values
      .map((v) => ({ t: zonedToIso(v.date, tz), productionKwh: v.value == null ? null : Math.round(v.value * factor * 1000) / 1000, consumptionKwh: null, importKwh: null, exportKwh: null }))
      .filter((p) => Date.parse(p.t) <= now.getTime());
    return { sourceId: this.id, demo: false, range, bucket: s.bucket, points };
  }
}

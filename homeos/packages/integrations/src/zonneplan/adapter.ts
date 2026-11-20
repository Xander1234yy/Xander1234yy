import type { AdapterHealth, Capability, DeviceCommand, EnergyHistory, EnergyPoint, EnergyRange, EnergySummary } from "@homeos/shared";
import type { AdapterContext, CommandResult, DeviceAdapter, DiscoveredDevice, EnergyProvider, StatusReport } from "../adapter";
import { RequestBudget } from "../cloud/budget";
import { ZonneplanApi, ZonneplanError, type MeasurementGroup, type P1Meta, type ZonneplanTokens } from "./api";

export interface ZonneplanConfig {
  connectionUuid: string;
  label: string;
}

const EXTERNAL_ID = "p1";
const META_MS = 3 * 60_000;
const TOTALS_MS = 15 * 60_000;
const kwh = (wh: number | undefined) => (typeof wh === "number" && Number.isFinite(wh) ? Math.round(wh) / 1000 : null);

/**
 * Zonneplan Connect (P1) via de NIET-OFFICIËLE app-API van Zonneplan (zie api.ts). Alleen-lezen: stroom van het net,
 * teruglevering en totalen. Opwek komt van SolarEdge; HomeOS rekent daarmee het eigen verbruik uit.
 */
export class ZonneplanAdapter implements DeviceAdapter {
  readonly integration = "zonneplan" as const;
  readonly demo = false;
  readonly id: string;
  readonly displayName = "Zonneplan Connect (niet-officieel)";
  readonly budget: RequestBudget;

  private ctx: AdapterContext | null = null;
  private tokens: ZonneplanTokens | null = null;
  private meta: P1Meta | null = null;
  private groups: MeasurementGroup[] = [];
  private lastOk: string | null = null;
  private lastError: string | null = null;
  private metaTimer: ReturnType<typeof setInterval> | null = null;
  private totalsTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly config: ZonneplanConfig,
    private readonly api: ZonneplanApi = new ZonneplanApi(),
    now: () => number = Date.now,
  ) {
    this.id = `zonneplan-${config.connectionUuid.replace(/-/g, "").slice(-6)}`;
    this.budget = new RequestBudget(1000, 0, now);
  }

  async connect(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    const raw = await ctx.secrets.get("tokens");
    try {
      this.tokens = raw ? (JSON.parse(raw) as ZonneplanTokens) : null;
    } catch {
      this.tokens = null;
    }
    if (!this.tokens) {
      this.lastError = "Niet ingelogd bij Zonneplan";
      return;
    }
    await this.refreshMeta();
    await this.refreshTotals();
    this.metaTimer = setInterval(() => void this.refreshMeta(), META_MS);
    this.totalsTimer = setInterval(() => void this.refreshTotals(), TOTALS_MS);
    this.metaTimer.unref?.();
    this.totalsTimer.unref?.();
  }

  async disconnect(): Promise<void> {
    if (this.metaTimer) clearInterval(this.metaTimer);
    if (this.totalsTimer) clearInterval(this.totalsTimer);
    this.ctx = null;
  }

  /** Geldig toegangstoken; vernieuwt (en bewaart) als het bijna verloopt. */
  private async token(force = false): Promise<string> {
    if (!this.tokens) throw new ZonneplanError("Niet ingelogd bij Zonneplan", "UNAUTHORIZED");
    if (force || this.tokens.expiresAt - 60_000 < Date.now()) {
      this.budget.spend();
      this.tokens = await this.api.refresh(this.tokens.refreshToken);
      await this.ctx?.secrets.set("tokens", JSON.stringify(this.tokens));
    }
    return this.tokens.accessToken;
  }

  private async call<T>(fn: (token: string) => Promise<T>): Promise<T> {
    if (!this.budget.canSpend("background")) throw new ZonneplanError(`Daglimiet bereikt; wacht ${this.budget.blockedForSeconds() || "even"}`, "RATE_LIMITED");
    try {
      this.budget.spend();
      return await fn(await this.token());
    } catch (e) {
      const err = e as ZonneplanError;
      if (err.code === "RATE_LIMITED") this.budget.blockFor(err.retryAfterSec ?? 300);
      if (err.code !== "UNAUTHORIZED") throw err;
      // Eén keer opnieuw met een vernieuwd token.
      this.budget.spend();
      return fn(await this.token(true));
    }
  }

  private async refreshMeta() {
    try {
      const conns = await this.call((t) => this.api.connections(t));
      const c = conns.find((x) => x.connectionUuid === this.config.connectionUuid);
      if (!c?.p1) throw new ZonneplanError("Geen Zonneplan Connect meer gevonden bij deze aansluiting", "SERVER");
      this.meta = c.p1.meta;
      this.lastOk = new Date().toISOString();
      this.lastError = null;
    } catch (e) {
      this.lastError = (e as Error).message;
    }
    this.emit();
  }

  private async refreshTotals() {
    try {
      this.groups = await this.call((t) => this.api.electricity(t, this.config.connectionUuid));
    } catch {
      /* totalen zijn aanvullend; status komt van refreshMeta */
    }
  }

  private emit() {
    this.ctx?.emit({ type: "device_state", externalId: EXTERNAL_ID, report: this.report() });
  }

  private live() {
    const m = this.meta;
    const imp = typeof m?.electricity_last_measured_delivery_value === "number" ? Math.max(0, m.electricity_last_measured_delivery_value) : null;
    const exp = typeof m?.electricity_last_measured_production_value === "number" ? Math.max(0, m.electricity_last_measured_production_value) : null;
    return { imp, exp, at: m?.electricity_last_measured_at ?? null };
  }

  private report(): StatusReport {
    const { imp, exp, at } = this.live();
    const unauthorized = this.lastError?.includes("opnieuw in") || this.lastError?.includes("Niet ingelogd");
    return {
      status: unauthorized ? "ERROR" : this.meta ? "ONLINE" : this.lastError ? "OFFLINE" : "CONNECTING",
      state: imp !== null && exp !== null ? { powerW: imp - exp } : {},
      lastSeen: this.lastOk,
      error: this.lastError,
      stateAt: at,
    };
  }

  private group(...types: string[]) {
    return this.groups.find((g) => g.type && types.includes(g.type));
  }

  readonly energy: EnergyProvider = {
    role: "grid",
    getSummary: async (): Promise<EnergySummary> => {
      if (!this.meta) throw new Error("Nog geen gegevens van Zonneplan");
      const { imp, exp, at } = this.live();
      const period = (g: MeasurementGroup | undefined) => ({ productionKwh: null, consumptionKwh: null, importKwh: kwh(g?.totals?.d), exportKwh: kwh(g?.totals?.p) });
      return {
        sourceId: this.id,
        demo: false,
        updatedAt: at ?? this.lastOk ?? new Date().toISOString(),
        currentProductionW: null,
        currentConsumptionW: null,
        gridImportW: imp,
        gridExportW: exp,
        today: period(this.group("live", "hours")),
        month: period(this.group("days")),
        year: period(this.group("months")),
      };
    },
    getHistory: async (range: EnergyRange): Promise<EnergyHistory> => {
      const spec = { day: ["hours", "hour"], week: ["days", "day"], month: ["days", "day"], year: ["months", "month"] } as const;
      const [type, bucket] = spec[range];
      let measurements = this.group(type)?.measurements ?? [];
      if (range === "week") measurements = measurements.slice(-7);
      const points: EnergyPoint[] = measurements
        .filter((m) => typeof m.date === "string" && !Number.isNaN(Date.parse(m.date)))
        .map((m) => ({ t: new Date(m.date).toISOString(), productionKwh: null, consumptionKwh: null, importKwh: kwh(m.values?.d), exportKwh: kwh(m.values?.p) }));
      return { sourceId: this.id, demo: false, range, bucket, points };
    },
  };

  async discover(): Promise<DiscoveredDevice[]> {
    return [
      {
        externalId: EXTERNAL_ID,
        name: this.config.label,
        brand: "Zonneplan",
        model: `Connect${this.meta?.dsmr_version ? ` (DSMR ${this.meta.dsmr_version})` : ""} · niet-officieel`,
        kind: "energy_meter",
        capabilities: ["energy_grid"],
        suggestedRoomId: null,
        refreshIntervalMs: META_MS,
      },
    ];
  }

  getCapabilities(): Capability[] {
    return ["energy_grid"];
  }

  async getStatus(externalId: string): Promise<StatusReport> {
    if (externalId !== EXTERNAL_ID) return { status: "UNKNOWN", state: {}, lastSeen: null, error: "Onbekend apparaat" };
    return this.report();
  }

  async executeCommand(_id: string, _c: DeviceCommand): Promise<CommandResult> {
    return { ok: false, code: "UNSUPPORTED", message: "De Zonneplan Connect is alleen-lezen" };
  }

  async healthCheck(): Promise<AdapterHealth> {
    return {
      adapterId: this.id,
      integration: this.integration,
      displayName: this.displayName,
      demo: false,
      status: !this.tokens ? "not_configured" : this.lastError ? "down" : this.meta ? "ok" : "degraded",
      message: !this.tokens ? "Niet ingelogd" : (this.lastError ?? `Niet-officiële koppeling · ${this.budget.remaining()} verzoeken over vandaag`),
      checkedAt: new Date().toISOString(),
    };
  }
}

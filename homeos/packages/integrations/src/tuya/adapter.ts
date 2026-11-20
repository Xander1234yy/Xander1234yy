import { COMMAND_CAPABILITY, type AdapterHealth, type Capability, type DeviceCommand, type DeviceState } from "@homeos/shared";
import type { AdapterContext, CommandResult, DeviceAdapter, DiscoveredDevice, StatusReport } from "../adapter";
import { CloudApiError, RequestBudget } from "../cloud/budget";
import { TuyaClient, type TuyaRegion } from "./client";

/**
 * Smart Life/Tuya-stekkers via de officiële Tuya Cloud OpenAPI.
 * - Gekoppeld Smart Life-account (Tuya-console → Devices → Link App Account); de UID van dat account bepaalt welke
 *   apparaten zichtbaar zijn.
 * - Eén verzoek per 2 minuten haalt alle apparaten met status op; specificaties (eenheden/schaal) één keer per apparaat.
 * - Alleen stekkers en schakelaars (categorieën cz, pc, kg); andere apparaten worden overgeslagen, niet geraden.
 */
const POLL_MS = 2 * 60_000;
const SUPPORTED_CATEGORIES = new Set(["cz", "pc", "kg"]);
const SWITCH_CODES = ["switch_1", "switch"];

export interface TuyaConfig {
  region: TuyaRegion;
  accessId: string;
  uid: string;
}

interface TuyaDeviceItem {
  id: string;
  name: string;
  category: string;
  product_name?: string;
  model?: string;
  online: boolean;
  status: { code: string; value: unknown }[];
  update_time?: number;
}
interface Spec {
  status?: { code: string; type: string; values: string }[];
}

function scaleOf(spec: Spec | undefined, code: string): number | null {
  const s = spec?.status?.find((x) => x.code === code);
  if (!s) return null;
  try {
    const v = JSON.parse(s.values) as { scale?: number; unit?: string };
    return typeof v.scale === "number" ? v.scale : 0;
  } catch {
    return null;
  }
}

export class TuyaAdapter implements DeviceAdapter {
  readonly integration = "smart_plug" as const;
  readonly demo = false;
  readonly id = "tuya";
  readonly displayName = "Smart Life / Tuya";
  readonly budget: RequestBudget;

  private ctx: AdapterContext | null = null;
  private client: TuyaClient | null = null;
  private devices = new Map<string, TuyaDeviceItem>();
  private specs = new Map<string, Spec>();
  private skipped = 0;
  private fetchedAt: string | null = null;
  private lastFetch = 0;
  private lastError: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly config: TuyaConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly nowMs: () => number = Date.now,
  ) {
    this.budget = new RequestBudget(5000, 300, nowMs);
  }

  async connect(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    const secret = await ctx.secrets.get("accessSecret");
    if (!secret) {
      this.lastError = "Geen Access Secret opgeslagen";
      return;
    }
    this.client = new TuyaClient({ region: this.config.region, accessId: this.config.accessId, accessSecret: secret }, this.fetchImpl, this.nowMs);
    if (ctx.serverless) {
      await this.restore();
      await this.refresh();
      return;
    }
    await this.refresh(true);
    this.timer = setInterval(() => void this.refresh(), 30_000);
    this.timer.unref?.();
  }

  private async restore() {
    const c = (await this.ctx?.cache?.load()) as { devices?: TuyaDeviceItem[]; specs?: [string, Spec][]; skipped?: number; fetchedAt?: string | null; lastFetch?: number; budget?: unknown } | null;
    if (!c) return;
    if (Array.isArray(c.devices)) this.devices = new Map(c.devices.map((d) => [d.id, d]));
    if (Array.isArray(c.specs)) this.specs = new Map(c.specs);
    if (typeof c.skipped === "number") this.skipped = c.skipped;
    this.fetchedAt = c.fetchedAt ?? null;
    if (typeof c.lastFetch === "number") this.lastFetch = c.lastFetch;
    this.budget.importState(c.budget);
  }

  private async persist() {
    if (!this.ctx?.serverless) return;
    await this.ctx.cache?.save({ devices: [...this.devices.values()], specs: [...this.specs], skipped: this.skipped, fetchedAt: this.fetchedAt, lastFetch: this.lastFetch, budget: this.budget.exportState() });
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.ctx = null;
  }

  private async call<T>(kind: "background" | "command", method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    if (!this.client) throw new CloudApiError("Niet geconfigureerd", "auth");
    if (!this.budget.canSpend(kind)) throw new CloudApiError("Daglimiet van HomeOS voor Tuya bereikt", "budget");
    this.budget.spend();
    return this.client.request<T>(method, path, {}, body);
  }

  async refresh(force = false): Promise<void> {
    if (!force && this.nowMs() - this.lastFetch < POLL_MS) return;
    this.lastFetch = this.nowMs();
    try {
      const list = await this.call<TuyaDeviceItem[]>("background", "GET", `/v1.0/users/${encodeURIComponent(this.config.uid)}/devices`);
      const supported = list.filter((d) => SUPPORTED_CATEGORIES.has(d.category) && d.status?.some((s) => SWITCH_CODES.includes(s.code)));
      this.skipped = list.length - supported.length;
      const before = new Set(this.devices.keys());
      this.devices = new Map(supported.map((d) => [d.id, d]));
      for (const d of supported) {
        if (!this.specs.has(d.id)) {
          try {
            this.specs.set(d.id, await this.call<Spec>("background", "GET", `/v1.0/devices/${encodeURIComponent(d.id)}/specifications`));
          } catch {
            /* zonder specificatie tonen we geen vermogen */
          }
        }
      }
      this.fetchedAt = new Date(this.nowMs()).toISOString();
      this.lastError = null;
      if (supported.length !== before.size || supported.some((d) => !before.has(d.id))) this.ctx?.emit({ type: "devices_changed" });
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.ctx?.logger.warn("Tuya verversen mislukt", { error: this.lastError });
    }
    for (const id of this.devices.keys()) this.ctx?.emit({ type: "device_state", externalId: id, report: this.report(id) });
    await this.persist();
  }

  private switchCode(d: TuyaDeviceItem): string {
    return SWITCH_CODES.find((c) => d.status.some((s) => s.code === c)) ?? "switch_1";
  }

  private state(d: TuyaDeviceItem): DeviceState {
    const get = (code: string) => d.status.find((s) => s.code === code)?.value;
    const state: DeviceState = { on: get(this.switchCode(d)) === true };
    const raw = get("cur_power");
    const scale = scaleOf(this.specs.get(d.id), "cur_power");
    if (typeof raw === "number" && scale !== null) state.powerW = Math.round((raw / 10 ** scale) * 10) / 10;
    return state;
  }

  getCapabilities(externalId: string): Capability[] {
    const d = this.devices.get(externalId);
    if (!d) return [];
    const caps: Capability[] = ["onoff"];
    if (d.status.some((s) => s.code === "cur_power") && scaleOf(this.specs.get(d.id), "cur_power") !== null) caps.push("power_metering");
    return caps;
  }

  async discover(): Promise<DiscoveredDevice[]> {
    return [...this.devices.values()].map((d) => ({
      externalId: d.id,
      name: (d.name || "Stekker").slice(0, 80),
      brand: "Smart Life / Tuya",
      model: (d.product_name || d.model || d.category).slice(0, 120),
      kind: "plug" as const,
      capabilities: this.getCapabilities(d.id),
      suggestedRoomId: null,
      refreshIntervalMs: POLL_MS,
    }));
  }

  private report(id: string): StatusReport {
    const d = this.devices.get(id);
    if (!d) return { status: "UNKNOWN", state: {}, lastSeen: null, error: "Apparaat niet gevonden in Smart Life" };
    if (!d.online) return { status: "OFFLINE", state: this.state(d), lastSeen: null, error: "De stekker is offline in de Tuya-cloud (stroom of wifi?)" };
    return { status: "ONLINE", state: this.state(d), lastSeen: this.fetchedAt, error: this.lastError, stateAt: this.fetchedAt };
  }

  async getStatus(id: string): Promise<StatusReport> {
    return this.report(id);
  }

  async executeCommand(id: string, command: DeviceCommand): Promise<CommandResult> {
    const d = this.devices.get(id);
    if (!d) return { ok: false, code: "NOT_FOUND", message: "Apparaat niet gevonden" };
    if (!this.getCapabilities(id).includes(COMMAND_CAPABILITY[command.type]) || command.type !== "set_power") {
      return { ok: false, code: "UNSUPPORTED", message: "Deze stekker ondersteunt alleen aan/uit" };
    }
    if (!d.online) return { ok: false, code: "DEVICE_UNAVAILABLE", message: "De stekker is offline" };
    try {
      const ok = await this.call<boolean>("command", "POST", `/v1.0/devices/${encodeURIComponent(id)}/commands`, { commands: [{ code: this.switchCode(d), value: command.on }] });
      if (ok !== true) return { ok: false, code: "ADAPTER_ERROR", message: "Tuya heeft de opdracht niet bevestigd" };
      // Werkelijke status teruglezen.
      const status = await this.call<{ code: string; value: unknown }[]>("command", "GET", `/v1.0/devices/${encodeURIComponent(id)}/status`);
      d.status = status;
      this.fetchedAt = new Date(this.nowMs()).toISOString();
      await this.persist();
      return { ok: true, report: this.report(id) };
    } catch (err) {
      return { ok: false, code: "ADAPTER_ERROR", message: err instanceof Error ? err.message : "Tuya niet bereikbaar" };
    }
  }

  async healthCheck(): Promise<AdapterHealth> {
    return {
      adapterId: this.id,
      integration: this.integration,
      displayName: this.displayName,
      demo: false,
      status: !this.client ? "not_configured" : this.lastError && !this.fetchedAt ? "down" : this.lastError ? "degraded" : "ok",
      message: this.lastError ?? `${this.devices.size} stekker(s)${this.skipped ? ` · ${this.skipped} ander(e) apparaat/apparaten overgeslagen (niet ondersteund)` : ""}`,
      checkedAt: new Date(this.nowMs()).toISOString(),
    };
  }
}

/** Controleert de gegevens met één token-aanvraag en één lijstaanvraag. */
export async function validateTuya(cfg: TuyaConfig, accessSecret: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!/^[a-z0-9]{10,64}$/i.test(cfg.accessId)) throw new CloudApiError("Access ID heeft een onverwacht formaat", "invalid");
  if (!/^[a-z0-9]{10,64}$/i.test(accessSecret)) throw new CloudApiError("Access Secret heeft een onverwacht formaat", "invalid");
  if (!/^[a-z0-9]{6,64}$/i.test(cfg.uid)) throw new CloudApiError("UID heeft een onverwacht formaat", "invalid");
  const client = new TuyaClient({ region: cfg.region, accessId: cfg.accessId, accessSecret }, fetchImpl);
  const list = await client.request<unknown[]>("GET", `/v1.0/users/${encodeURIComponent(cfg.uid)}/devices`);
  return Array.isArray(list) ? list.length : 0;
}

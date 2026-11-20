import { COMMAND_CAPABILITY, type AdapterHealth, type Capability, type DeviceCommand } from "@homeos/shared";
import type { AdapterContext, CommandResult, DeviceAdapter, DiscoveredDevice, StatusReport } from "../adapter";
import { CloudApiError, RequestBudget } from "../cloud/budget";
import { DAIKIN_API_URL, tokenRequest, type DaikinTokens } from "./oauth";
import { parseClimate, setpointFor, type OnectaDevice, type OnectaManagementPoint, type ParsedClimate } from "./parse";

/**
 * Daikin airco's via de officiële Daikin Onecta Cloud API.
 * - OAuth2 (Daikin Developer Portal); client secret en tokens versleuteld in de connector.
 * - Daglimiet 200 verzoeken per gebruiker: verversen elke 10 minuten (1 verzoek voor alle units),
 *   met een reserve van 40 verzoeken voor jouw opdrachten. Limiet-headers van Daikin worden gevolgd.
 */
const POLL_MS = 10 * 60_000;
const AFTER_COMMAND_MS = 90_000;

export interface DaikinConfig {
  clientId: string;
  redirectUri: string;
}

export class DaikinAdapter implements DeviceAdapter {
  readonly integration = "climate" as const;
  readonly demo = false;
  readonly id = "daikin-onecta";
  readonly displayName = "Daikin Onecta";
  readonly budget: RequestBudget;

  private ctx: AdapterContext | null = null;
  private tokens: DaikinTokens | null = null;
  private clientSecret: string | null = null;
  private units = new Map<string, { raw: OnectaDevice; parsed: ParsedClimate }>();
  private fetchedAt: string | null = null;
  private lastFetch = 0;
  private lastError: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshSoon: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly config: DaikinConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly nowMs: () => number = Date.now,
  ) {
    this.budget = new RequestBudget(200, 40, nowMs);
  }

  async connect(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    this.clientSecret = await ctx.secrets.get("clientSecret");
    const raw = await ctx.secrets.get("tokens");
    this.tokens = raw ? (JSON.parse(raw) as DaikinTokens) : null;
    if (!this.tokens || !this.clientSecret) {
      this.lastError = "Nog niet aangemeld bij Daikin";
      return;
    }
    await this.refresh(true);
    this.timer = setInterval(() => void this.refresh(), 60_000);
    this.timer.unref?.();
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.refreshSoon) clearTimeout(this.refreshSoon);
    this.ctx = null;
  }

  // ───────────── HTTP ─────────────

  private async accessToken(): Promise<string> {
    if (!this.tokens || !this.clientSecret) throw new CloudApiError("Niet aangemeld bij Daikin", "auth");
    if (this.tokens.expiresAt > this.nowMs()) return this.tokens.accessToken;
    this.tokens = await tokenRequest(this.fetchImpl, {
      grant_type: "refresh_token",
      refresh_token: this.tokens.refreshToken,
      client_id: this.config.clientId,
      client_secret: this.clientSecret,
    }, this.nowMs());
    await this.ctx?.secrets.set("tokens", JSON.stringify(this.tokens));
    return this.tokens.accessToken;
  }

  private async api(method: "GET" | "PATCH", path: string, kind: "background" | "command", body?: unknown): Promise<Response> {
    if (!this.budget.canSpend(kind)) {
      const wait = this.budget.blockedForSeconds();
      throw new CloudApiError(wait ? `Daikin-limiet bereikt, probeer het over ${Math.ceil(wait / 60)} minuten opnieuw` : "Daglimiet van Daikin (bijna) bereikt", "budget");
    }
    const token = await this.accessToken();
    this.budget.spend();
    let res: Response;
    try {
      res = await this.fetchImpl(DAIKIN_API_URL + path, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new CloudApiError("Daikin-cloud niet bereikbaar", "network");
    }
    const remaining = Number(res.headers.get("x-ratelimit-remaining-day"));
    if (res.headers.has("x-ratelimit-remaining-day")) this.budget.syncRemaining(remaining);
    if (res.status === 429) {
      const after = Number(res.headers.get("retry-after")) || 3600;
      this.budget.blockFor(after);
      throw new CloudApiError(`Daikin-limiet bereikt, probeer het over ${Math.ceil(after / 60)} minuten opnieuw`, "rate_limited");
    }
    if (res.status === 401) {
      this.tokens = this.tokens ? { ...this.tokens, expiresAt: 0 } : null;
      throw new CloudApiError("Daikin-aanmelding verlopen; meld opnieuw aan in Instellingen als dit blijft gebeuren", "auth");
    }
    return res;
  }

  async refresh(force = false): Promise<void> {
    if (!force && this.nowMs() - this.lastFetch < POLL_MS) return;
    this.lastFetch = this.nowMs();
    try {
      const res = await this.api("GET", "/v1/gateway-devices", "background");
      if (!res.ok) throw new CloudApiError(`Daikin gaf status ${res.status}`, "server");
      const devices = (await res.json()) as OnectaDevice[];
      const before = new Set(this.units.keys());
      this.units = new Map(
        devices.flatMap((d) => {
          const parsed = parseClimate(d);
          return parsed ? [[d.id, { raw: d, parsed }] as const] : [];
        }),
      );
      this.fetchedAt = new Date(this.nowMs()).toISOString();
      this.lastError = null;
      if (this.units.size !== before.size || [...this.units.keys()].some((k) => !before.has(k))) this.ctx?.emit({ type: "devices_changed" });
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.ctx?.logger.warn("Daikin verversen mislukt", { error: this.lastError });
    }
    for (const id of this.units.keys()) this.ctx?.emit({ type: "device_state", externalId: id, report: this.report(id) });
  }

  // ───────────── HomeOS-model ─────────────

  getCapabilities(externalId: string): Capability[] {
    const u = this.units.get(externalId)?.parsed;
    if (!u) return [];
    const caps: Capability[] = [];
    if (u.canPower) caps.push("onoff");
    if (u.canMode || u.canSetpoint) caps.push("climate");
    return caps;
  }

  async discover(): Promise<DiscoveredDevice[]> {
    return [...this.units.values()].map(({ parsed }) => ({
      externalId: parsed.deviceId,
      name: parsed.name,
      brand: "Daikin",
      model: parsed.model,
      kind: "climate" as const,
      capabilities: this.getCapabilities(parsed.deviceId),
      suggestedRoomId: null,
      refreshIntervalMs: POLL_MS,
    }));
  }

  private report(externalId: string): StatusReport {
    const u = this.units.get(externalId)?.parsed;
    if (!u) return { status: "UNKNOWN", state: {}, lastSeen: null, error: "Unit niet gevonden in Onecta" };
    const state = { on: u.on ?? undefined, climate: u.climate };
    if (!u.online) return { status: "OFFLINE", state, lastSeen: null, error: "De unit heeft geen verbinding met de Daikin-cloud" };
    return { status: "ONLINE", state, lastSeen: this.fetchedAt, error: this.lastError, stateAt: this.fetchedAt };
  }

  async getStatus(externalId: string): Promise<StatusReport> {
    return this.report(externalId);
  }

  async executeCommand(externalId: string, command: DeviceCommand): Promise<CommandResult> {
    const unit = this.units.get(externalId);
    if (!unit) return { ok: false, code: "NOT_FOUND", message: "Unit niet gevonden" };
    if (!this.getCapabilities(externalId).includes(COMMAND_CAPABILITY[command.type])) return { ok: false, code: "UNSUPPORTED", message: "Deze unit ondersteunt dit niet via de API" };
    if (!unit.parsed.online) return { ok: false, code: "DEVICE_UNAVAILABLE", message: "De unit is offline in de Daikin-cloud" };
    const mp = unit.raw.managementPoints.find((m) => m.embeddedId === unit.parsed.embeddedId)!;
    let characteristic: string;
    let body: { value: unknown; path?: string };
    switch (command.type) {
      case "set_power":
        characteristic = "onOffMode";
        body = { value: command.on ? "on" : "off" };
        break;
      case "set_hvac_mode":
        if (!unit.parsed.climate.modes.includes(command.mode)) return { ok: false, code: "UNSUPPORTED", message: `Modus ${command.mode} wordt door deze unit niet ondersteund` };
        characteristic = "operationMode";
        body = { value: command.mode };
        break;
      case "set_target_temperature": {
        const mode = unit.parsed.climate.mode;
        const sp = setpointFor(mp, mode);
        if (!sp || sp.settable === false || !mode) return { ok: false, code: "UNSUPPORTED", message: "In deze modus kan geen temperatuur worden ingesteld" };
        const v = command.temperatureC;
        if ((sp.minValue != null && v < sp.minValue) || (sp.maxValue != null && v > sp.maxValue)) {
          return { ok: false, code: "UNSUPPORTED", message: `Kies een temperatuur tussen ${sp.minValue} en ${sp.maxValue} °C` };
        }
        if (sp.stepValue && Math.abs(v / sp.stepValue - Math.round(v / sp.stepValue)) > 1e-6) return { ok: false, code: "UNSUPPORTED", message: `Stappen van ${sp.stepValue} °C` };
        characteristic = "temperatureControl";
        body = { value: v, path: `/operationModes/${mode}/setpoints/roomTemperature` };
        break;
      }
      default:
        return { ok: false, code: "UNSUPPORTED", message: "Opdracht niet ondersteund" };
    }
    try {
      const path = `/v1/gateway-devices/${encodeURIComponent(unit.raw.id)}/management-points/${encodeURIComponent(unit.parsed.embeddedId)}/characteristics/${characteristic}`;
      const res = await this.api("PATCH", path, "command", body);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, code: "ADAPTER_ERROR", message: `Daikin weigerde de opdracht (status ${res.status})${text ? `: ${text.slice(0, 120)}` : ""}` };
      }
    } catch (err) {
      return { ok: false, code: "ADAPTER_ERROR", message: err instanceof Error ? err.message : "Daikin niet bereikbaar" };
    }
    // Daikin heeft de wijziging geaccepteerd. De cloud kan direct na een PATCH nog de oude waarde geven,
    // daarom werken we de lokale waarde bij en lezen we na 90 s opnieuw uit ter controle.
    this.applyLocal(unit, mp, command);
    if (this.refreshSoon) clearTimeout(this.refreshSoon);
    this.refreshSoon = setTimeout(() => {
      this.lastFetch = 0;
      void this.refresh(true);
    }, AFTER_COMMAND_MS);
    this.refreshSoon.unref?.();
    return { ok: true, report: { ...this.report(externalId), stateAt: new Date(this.nowMs()).toISOString() } };
  }

  private applyLocal(unit: { raw: OnectaDevice; parsed: ParsedClimate }, m: OnectaManagementPoint, c: DeviceCommand) {
    if (c.type === "set_power" && m.onOffMode) m.onOffMode.value = c.on ? "on" : "off";
    if (c.type === "set_hvac_mode" && m.operationMode) m.operationMode.value = c.mode;
    if (c.type === "set_target_temperature") {
      const sp = setpointFor(m, unit.parsed.climate.mode);
      if (sp) sp.value = c.temperatureC;
    }
    unit.parsed = parseClimate(unit.raw)!;
  }

  async healthCheck(): Promise<AdapterHealth> {
    return {
      adapterId: this.id,
      integration: this.integration,
      displayName: this.displayName,
      demo: false,
      status: !this.tokens ? "not_configured" : this.lastError && !this.fetchedAt ? "down" : this.lastError ? "degraded" : "ok",
      message: `${this.lastError ?? `${this.units.size} unit(s)`} · ${this.budget.remaining()} van 200 verzoeken over vandaag`,
      checkedAt: new Date(this.nowMs()).toISOString(),
    };
  }
}

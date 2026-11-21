import type { AdapterHealth, Capability, DeviceCommand } from "@homeos/shared";
import type { AdapterContext, CommandResult, DeviceAdapter, DiscoveredDevice, StatusReport } from "../adapter";
import { RequestBudget } from "../cloud/budget";
import { GoogleAssistantError, http2AssistantTransport, refreshGoogleTokens, type AssistantTransport, type GoogleTokens } from "./assistant";

/**
 * Apparaten uit Google Home (bijv. IKEA Matter-stekkers) via de officiële Google Assistant SDK.
 * - Alleen aan/uit, als tekstopdracht ("zet <naam> aan"). De gebruiker kiest zelf welke apparaten (naam zoals in
 *   Google Home) HomeOS mag bedienen; we raden niets.
 * - Google meldt níet terug of het apparaat werkelijk schakelde. De toestand blijft daarom "onbekend" (geen `on`),
 *   en een geslaagde opdracht betekent alleen "Google heeft de opdracht aangenomen".
 * - Google staat ±500 opdrachten per dag per project toe; HomeOS houdt zelf een daglimiet bij.
 */
export interface GoogleHomeDevice {
  id: string;
  name: string;
}
export interface GoogleHomeConfig {
  clientId: string;
  languageCode: string;
  devices: GoogleHomeDevice[];
}

const DAILY_LIMIT = 450;

interface Cache {
  budget?: unknown;
  lastOkAt?: string | null;
  lastError?: string | null;
  lastReply?: string | null;
}

export function commandText(name: string, on: boolean, languageCode: string): string {
  if (languageCode.toLowerCase().startsWith("nl")) return `zet ${name} ${on ? "aan" : "uit"}`;
  return `turn ${on ? "on" : "off"} ${name}`;
}

export class GoogleHomeAdapter implements DeviceAdapter {
  readonly integration = "smart_plug" as const;
  readonly demo = false;
  readonly id = "googlehome";
  readonly displayName = "Google Home (via Google Assistent)";
  readonly budget: RequestBudget;

  private ctx: AdapterContext | null = null;
  private clientSecret: string | null = null;
  private tokens: GoogleTokens | null = null;
  private lastOkAt: string | null = null;
  private lastError: string | null = null;
  private lastReply: string | null = null;

  constructor(
    readonly config: GoogleHomeConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly transport: AssistantTransport = http2AssistantTransport,
    private readonly nowMs: () => number = Date.now,
  ) {
    this.budget = new RequestBudget(DAILY_LIMIT, 0, nowMs);
  }

  async connect(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    this.clientSecret = await ctx.secrets.get("clientSecret");
    const raw = await ctx.secrets.get("tokens");
    this.tokens = raw ? (JSON.parse(raw) as GoogleTokens) : null;
    const c = ((await ctx.cache?.load()) ?? null) as Cache | null;
    if (c) {
      this.budget.importState(c.budget);
      this.lastOkAt = c.lastOkAt ?? null;
      this.lastError = c.lastError ?? null;
      this.lastReply = c.lastReply ?? null;
    }
  }

  async disconnect(): Promise<void> {
    this.ctx = null;
  }

  private async persist() {
    await this.ctx?.cache?.save({ budget: this.budget.exportState(), lastOkAt: this.lastOkAt, lastError: this.lastError, lastReply: this.lastReply } satisfies Cache);
  }

  private configured() {
    return !!(this.tokens && this.clientSecret);
  }

  private async accessToken(): Promise<string> {
    if (!this.tokens || !this.clientSecret) throw new GoogleAssistantError("Niet gekoppeld met Google", "UNAUTHORIZED");
    if (this.tokens.expiresAt - 60_000 > this.nowMs()) return this.tokens.accessToken;
    this.tokens = await refreshGoogleTokens(this.fetchImpl, this.config.clientId, this.clientSecret, this.tokens.refreshToken, this.nowMs());
    await this.ctx?.secrets.set("tokens", JSON.stringify(this.tokens));
    return this.tokens.accessToken;
  }

  getCapabilities(externalId: string): Capability[] {
    return this.config.devices.some((d) => d.id === externalId) ? ["onoff"] : [];
  }

  async discover(): Promise<DiscoveredDevice[]> {
    return this.config.devices.map((d) => ({
      externalId: d.id,
      name: d.name.slice(0, 80),
      brand: "Google Home",
      model: "Via Google Assistent (status niet terug te lezen)",
      kind: "plug" as const,
      capabilities: ["onoff"] as Capability[],
      suggestedRoomId: null,
    }));
  }

  private report(id: string): StatusReport {
    if (!this.config.devices.some((d) => d.id === id)) return { status: "UNKNOWN", state: {}, lastSeen: null, error: "Apparaat niet gevonden" };
    if (!this.configured()) return { status: "UNKNOWN", state: {}, lastSeen: null, error: "Niet gekoppeld met Google" };
    // Geen `on`: Google meldt de werkelijke toestand niet. ONLINE betekent hier: de route via Google is beschikbaar.
    return { status: "ONLINE", state: {}, lastSeen: null, error: null };
  }

  async getStatus(id: string): Promise<StatusReport> {
    return this.report(id);
  }

  async executeCommand(id: string, command: DeviceCommand): Promise<CommandResult> {
    const d = this.config.devices.find((x) => x.id === id);
    if (!d) return { ok: false, code: "NOT_FOUND", message: "Apparaat niet gevonden" };
    if (command.type !== "set_power") return { ok: false, code: "UNSUPPORTED", message: "Via Google Home kan HomeOS alleen aan- en uitzetten" };
    if (!this.configured()) return { ok: false, code: "DEVICE_UNAVAILABLE", message: "Niet gekoppeld met Google" };
    if (!this.budget.canSpend("command")) return { ok: false, code: "ADAPTER_ERROR", message: "Daglimiet van HomeOS voor Google Assistent bereikt" };
    try {
      const token = await this.accessToken();
      this.budget.spend();
      const r = await this.transport(token, commandText(d.name, command.on, this.config.languageCode), this.config.languageCode);
      this.lastOkAt = new Date(this.nowMs()).toISOString();
      this.lastError = null;
      this.lastReply = r.text;
      await this.persist();
      return { ok: true, report: this.report(id) };
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      await this.persist();
      const unavailable = e instanceof GoogleAssistantError && (e.code === "UNAUTHORIZED" || e.code === "UNAVAILABLE");
      return { ok: false, code: unavailable ? "DEVICE_UNAVAILABLE" : "ADAPTER_ERROR", message: this.lastError };
    }
  }

  async healthCheck(): Promise<AdapterHealth> {
    const n = this.config.devices.length;
    return {
      adapterId: this.id,
      integration: this.integration,
      displayName: this.displayName,
      demo: false,
      status: !this.configured() ? "not_configured" : this.lastError ? "degraded" : "ok",
      message: !this.configured()
        ? "Niet gekoppeld met Google"
        : (this.lastError ?? `${n} apparaat/apparaten · alleen opdrachten, status niet terug te lezen${this.lastReply ? ` · Google: "${this.lastReply.slice(0, 80)}"` : ""}`),
      checkedAt: new Date(this.nowMs()).toISOString(),
    };
  }
}

import type { AdapterHealth, Capability, DeviceCommand, MediaState } from "@homeos/shared";
import type { AdapterContext, CommandResult, DeviceAdapter, DiscoveredDevice, StatusReport } from "../adapter";
import { WebOsClient, WebOsError, type ClientOptions } from "./client";
import { buildSources, EP, STANDBY_STATES, type TvSource } from "./protocol";
import { sendWakeOnLan, type WolSender } from "./wol";

export interface WebOsTvConfig {
  tvId: string;
  host: string;
  name: string;
  model: string;
  scheme: "wss" | "ws";
  fingerprint256: string | null;
  mac: string | null;
}

const EXTERNAL_ID = "tv";
const RECONNECT_MS = 15_000;

/**
 * LG webOS-tv via het lokale SSAP-protocol (zie protocol.ts). Live status via abonnementen;
 * als de tv uit staat is hij onbereikbaar (OFFLINE) en kan hij alleen via Wake-on-LAN aan.
 */
export class WebOsAdapter implements DeviceAdapter {
  readonly integration = "lg_webos" as const;
  readonly demo = false;
  readonly id: string;
  readonly displayName: string;

  private ctx: AdapterContext | null = null;
  private client: WebOsClient | null = null;
  private clientKey: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private connecting: Promise<void> | null = null;
  private lastOk: string | null = null;
  private lastError: string | null = null;
  private powerState: string | null = null;
  private volume: number | undefined;
  private muted: boolean | undefined;
  private foreground: string | null = null;
  private inputs: unknown = [];
  private launchPoints: unknown = [];
  private sources: TvSource[] = [];

  constructor(
    readonly config: WebOsTvConfig,
    private readonly deps: { wol?: WolSender; ports?: Pick<ClientOptions, "wssPort" | "wsPort">; reconnectMs?: number } = {},
  ) {
    this.id = `lgtv-${config.tvId.slice(-6)}`;
    this.displayName = `LG-tv (${config.name})`;
  }

  async connect(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    this.stopped = false;
    this.clientKey = await ctx.secrets.get("clientKey");
    if (!this.clientKey) {
      this.lastError = "Geen client-key: koppel de tv opnieuw";
      return;
    }
    await this.ensureConnected();
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.client?.close();
    this.client = null;
    this.ctx = null;
  }

  private scheduleReconnect() {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.ensureConnected();
    }, this.deps.reconnectMs ?? RECONNECT_MS);
    this.timer.unref?.();
  }

  private ensureConnected(): Promise<void> {
    if (this.client?.connected || !this.clientKey || this.stopped) return Promise.resolve();
    this.connecting ??= this.doConnect().finally(() => (this.connecting = null));
    return this.connecting;
  }

  private async doConnect() {
    const client = new WebOsClient({ host: this.config.host, fingerprint256: this.config.fingerprint256, scheme: this.config.scheme, ...this.deps.ports });
    try {
      await client.open();
      await client.register(this.clientKey, { allowPrompt: false });
      this.client = client;
      client.onClose = () => {
        this.client = null;
        this.powerState = null;
        this.emitState();
        this.scheduleReconnect();
      };
      await this.subscribeAll(client);
      this.lastError = null;
      this.lastOk = this.now();
      this.emitState();
    } catch (e) {
      client.close();
      const err = e as WebOsError;
      // Onbereikbaar is normaal als de tv uit staat; geen foutmelding tonen.
      this.lastError = err.code === "UNREACHABLE" || err.code === "CLOSED" ? null : err.message;
      this.emitState();
      // Bij een geweigerde key of ander certificaat niet blijven proberen: de gebruiker moet opnieuw koppelen.
      if (err.code !== "REJECTED" && err.code !== "CERTIFICATE") this.scheduleReconnect();
    }
  }

  private async subscribeAll(c: WebOsClient) {
    const opt = <T>(p: Promise<T>) => p.catch(() => undefined);
    await opt(
      c.subscribe(EP.powerState, (p) => {
        this.powerState = typeof p.state === "string" ? p.state : this.powerState;
        this.touch();
      }),
    );
    await opt(
      c.subscribe(EP.volume, (p) => {
        const s = (p.volumeStatus as Record<string, unknown> | undefined) ?? p;
        if (typeof s.volume === "number") this.volume = Math.max(0, Math.min(100, s.volume));
        const m = s.muteStatus ?? s.mute ?? s.muted;
        if (typeof m === "boolean") this.muted = m;
        this.touch();
      }),
    );
    await opt(
      c.subscribe(EP.foregroundApp, (p) => {
        this.foreground = typeof p.appId === "string" ? p.appId : null;
        this.touch();
      }),
    );
    const inputs = await opt(c.request(EP.inputs));
    this.inputs = inputs?.devices ?? [];
    const apps = await opt(c.request(EP.launchPoints));
    this.launchPoints = apps?.launchPoints ?? [];
    this.sources = buildSources(this.inputs, this.launchPoints);
  }

  private touch() {
    this.lastOk = this.now();
    this.emitState();
  }

  private emitState() {
    this.ctx?.emit({ type: "device_state", externalId: EXTERNAL_ID, report: this.report() });
  }

  private isOn() {
    if (!this.client?.connected) return false;
    if (this.powerState) return !STANDBY_STATES.has(this.powerState);
    return !!this.foreground;
  }

  private report(): StatusReport {
    const connected = !!this.client?.connected;
    if (!connected) {
      return {
        status: this.lastError ? "ERROR" : this.clientKey ? "OFFLINE" : "ERROR",
        state: { on: false, media: { power: "standby", playback: "idle" } },
        lastSeen: this.lastOk,
        error: this.lastError ?? (this.clientKey ? null : "Niet gekoppeld"),
      };
    }
    const on = this.isOn();
    const current = this.sources.find((s) => s.appId === this.foreground);
    const media: MediaState = {
      power: on ? "on" : "standby",
      playback: on ? "unknown" : "idle",
      ...(on && current ? { app: current.label, source: current.id } : {}),
      ...(this.volume !== undefined ? { volume: this.volume } : {}),
      ...(this.muted !== undefined ? { muted: this.muted } : {}),
      sources: this.sources.map(({ id, label, type }) => ({ id, label, type })),
    };
    return { status: "ONLINE", state: { on, media }, lastSeen: this.lastOk, error: null };
  }

  async discover(): Promise<DiscoveredDevice[]> {
    return [
      { externalId: EXTERNAL_ID, name: this.config.name, brand: "LG", model: this.config.model, kind: "media", capabilities: this.getCapabilities(EXTERNAL_ID), suggestedRoomId: "woonkamer" },
    ];
  }

  getCapabilities(_externalId: string): Capability[] {
    const caps: Capability[] = ["media_power", "media_playback", "volume", "source_select"];
    if (this.config.mac) caps.push("wake_on_lan");
    return caps;
  }

  async getStatus(externalId: string): Promise<StatusReport> {
    if (externalId !== EXTERNAL_ID) return { status: "UNKNOWN", state: {}, lastSeen: null, error: "Onbekend apparaat" };
    return this.report();
  }

  private async readBack(): Promise<StatusReport> {
    const c = this.client;
    if (c?.connected) {
      const v = await c.request(EP.volume).catch(() => undefined);
      if (v) {
        const s = (v.volumeStatus as Record<string, unknown> | undefined) ?? v;
        if (typeof s.volume === "number") this.volume = s.volume;
        const m = s.muteStatus ?? s.mute ?? s.muted;
        if (typeof m === "boolean") this.muted = m;
      }
      const f = await c.request(EP.foregroundApp).catch(() => undefined);
      if (f && typeof f.appId === "string") this.foreground = f.appId;
    }
    return this.report();
  }

  async executeCommand(externalId: string, command: DeviceCommand): Promise<CommandResult> {
    if (externalId !== EXTERNAL_ID) return { ok: false, code: "NOT_FOUND", message: "Onbekend apparaat" };
    if (command.type === "media_power" && command.on) return this.powerOn();
    const c = this.client;
    if (!c?.connected) return { ok: false, code: "DEVICE_UNAVAILABLE", message: "De tv staat uit of is niet bereikbaar." };
    try {
      switch (command.type) {
        case "media_power":
          if (this.isOn()) c.fire(EP.turnOff); // de tv antwoordt niet altijd bij uitzetten
          break;
        case "set_volume":
          await c.request(EP.setVolume, { volume: command.volume });
          break;
        case "volume_step":
          await c.request(command.direction === "up" ? EP.volumeUp : EP.volumeDown);
          break;
        case "set_mute":
          await c.request(EP.setMute, { mute: command.muted });
          break;
        case "select_source": {
          const src = this.sources.find((s) => s.id === command.sourceId);
          if (!src) return { ok: false, code: "UNSUPPORTED", message: "Deze ingang of app staat niet op de tv." };
          if (src.type === "input") await c.request(EP.switchInput, { inputId: src.id.slice("input:".length) });
          else await c.request(EP.launch, { id: src.appId });
          break;
        }
        case "media":
          if (command.action === "play") await c.request(EP.play);
          else if (command.action === "pause") await c.request(EP.pause);
          else return { ok: false, code: "UNSUPPORTED", message: "Volgende/vorige wordt niet ondersteund door de tv-API." };
          break;
        default:
          return { ok: false, code: "UNSUPPORTED", message: "Niet ondersteund door de tv" };
      }
    } catch (e) {
      return { ok: false, code: "ADAPTER_ERROR", message: (e as Error).message };
    }
    return { ok: true, report: await this.readBack() };
  }

  private async powerOn(): Promise<CommandResult> {
    const c = this.client;
    if (c?.connected && this.powerState === "Screen Off") {
      try {
        await c.request(EP.turnOnScreen);
        return { ok: true, report: await this.readBack() };
      } catch {
        /* val terug op Wake-on-LAN */
      }
    }
    if (c?.connected && this.isOn()) return { ok: true, report: this.report() };
    if (!this.config.mac) {
      return { ok: false, code: "UNSUPPORTED", message: "Aanzetten via het netwerk kan niet: het MAC-adres van de tv is onbekend. Koppel de tv opnieuw en vul het MAC-adres in." };
    }
    try {
      await (this.deps.wol ?? sendWakeOnLan)(this.config.mac, this.config.host);
    } catch (e) {
      return { ok: false, code: "ADAPTER_ERROR", message: `Wake-on-LAN versturen mislukt: ${(e as Error).message}` };
    }
    // Niet doen alsof hij al aan is: de status wordt "aan" zodra de tv zelf reageert.
    this.scheduleReconnectSoon();
    return { ok: true, report: this.report() };
  }

  private scheduleReconnectSoon() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    let tries = 0;
    const tick = () => {
      if (this.stopped || this.client?.connected || tries++ > 10) return;
      void this.ensureConnected().then(() => {
        if (!this.client?.connected) setTimeout(tick, 3000).unref?.();
      });
    };
    setTimeout(tick, 3000).unref?.();
  }

  async healthCheck(): Promise<AdapterHealth> {
    const connected = !!this.client?.connected;
    return {
      adapterId: this.id,
      integration: this.integration,
      displayName: this.displayName,
      demo: false,
      status: !this.clientKey ? "not_configured" : this.lastError ? "down" : connected ? "ok" : "degraded",
      message: !this.clientKey
        ? "Niet gekoppeld"
        : (this.lastError ?? (connected ? `Verbonden · ${this.config.host}${this.config.scheme === "ws" ? " · onversleuteld" : ""}` : "Tv staat uit of is niet bereikbaar")),
      checkedAt: this.now(),
    };
  }

  private now() {
    return (this.ctx?.now() ?? new Date()).toISOString();
  }
}

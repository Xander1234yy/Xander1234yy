import { COMMAND_CAPABILITY, roomSlug, type AdapterHealth, type Capability, type DeviceCommand, type DeviceState } from "@homeos/shared";
import type { AdapterContext, CommandResult, DeviceAdapter, DiscoveredDevice, StatusReport } from "../adapter";
import { hexToXy, kelvinToMirek, mirekToKelvin, xyToHex, type Gamut } from "./color";
import { createHueHttp, type HueHttp } from "./net";
import type { HueDevice, HueLight, HueList, HueRoom, HueScene, HueZigbeeConnectivity } from "./types";

export interface HueBridgeConfig {
  bridgeId: string;
  host: string;
  name: string;
  fingerprint256: string;
}

const REFRESH_MS = 10_000;
const MIN_GAP_MS = 110; // officiële richtlijn: max. ~10 lichtopdrachten per seconde

/**
 * Philips Hue via de officiële lokale CLIP API v2 van de Hue Bridge.
 * - Application key staat versleuteld in de SecretStore van de connector (nooit in de cloud).
 * - Certificaat-pinning op de vingerafdruk van het koppelmoment.
 * - Live status via de eventstream, met periodieke volledige verversing als vangnet.
 */
export class HueAdapter implements DeviceAdapter {
  readonly integration = "philips_hue" as const;
  readonly demo = false;
  readonly id: string;
  readonly displayName: string;

  private ctx: AdapterContext | null = null;
  private http: HueHttp | null = null;
  private lights = new Map<string, HueLight>();
  private devices = new Map<string, HueDevice>();
  private rooms = new Map<string, HueRoom>();
  private connectivity = new Map<string, HueZigbeeConnectivity["status"]>(); // device id → status
  private scenes: HueScene[] = [];
  private lastOk: string | null = null;
  private lastError: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private abort: AbortController | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastSend = 0;

  constructor(
    readonly config: HueBridgeConfig,
    private readonly httpFactory: (appKey: string, ctx: AdapterContext) => HueHttp = (appKey) =>
      createHueHttp({ host: config.host, fingerprint256: config.fingerprint256, appKey }),
    opts: { id?: string; displayName?: string } = {},
  ) {
    this.id = opts.id ?? `hue-${config.bridgeId.slice(-6)}`;
    this.displayName = opts.displayName ?? `Philips Hue (${config.name})`;
  }

  /** Cloudmodus: hoe lang opgehaalde gegevens geldig blijven (geen eventstream mogelijk). */
  private static readonly SERVERLESS_FRESH_MS = 30_000;
  private refreshedAt = 0;

  private async restore() {
    const c = (await this.ctx?.cache?.load()) as {
      lights?: HueLight[]; devices?: HueDevice[]; rooms?: HueRoom[]; connectivity?: [string, HueZigbeeConnectivity["status"]][]; scenes?: HueScene[]; lastOk?: string | null; refreshedAt?: number;
    } | null;
    if (!c) return;
    this.lights = new Map((c.lights ?? []).map((l) => [l.id, l]));
    this.devices = new Map((c.devices ?? []).map((d) => [d.id, d]));
    this.rooms = new Map((c.rooms ?? []).map((r) => [r.id, r]));
    this.connectivity = new Map(c.connectivity ?? []);
    this.scenes = c.scenes ?? [];
    this.lastOk = c.lastOk ?? null;
    this.refreshedAt = c.refreshedAt ?? 0;
  }

  private async persist() {
    if (!this.ctx?.serverless) return;
    await this.ctx.cache?.save({
      lights: [...this.lights.values()], devices: [...this.devices.values()], rooms: [...this.rooms.values()], connectivity: [...this.connectivity], scenes: this.scenes, lastOk: this.lastOk, refreshedAt: this.refreshedAt,
    });
  }

  async connect(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    const key = await ctx.secrets.get("appKey");
    if (!key) {
      this.lastError = "Geen application key: koppel de bridge opnieuw";
      return;
    }
    this.http = this.httpFactory(key, ctx);
    if (ctx.serverless) {
      await this.restore();
      if (Date.now() - this.refreshedAt >= HueAdapter.SERVERLESS_FRESH_MS) await this.refresh();
      return;
    }
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref?.();
    void this.runEventStream();
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.abort?.abort();
    this.ctx = null;
  }

  // ───────────── gegevens ophalen ─────────────

  private async get<T>(type: string): Promise<T[]> {
    const r = await this.http!.request<HueList<T>>("GET", `/clip/v2/resource/${type}`);
    if (r.status === 403 || r.status === 401) throw new Error("De bridge weigert de application key. Koppel opnieuw.");
    if (r.status !== 200) throw new Error(`Bridge gaf status ${r.status}`);
    return r.body?.data ?? [];
  }

  async refresh(): Promise<void> {
    if (!this.http) return;
    try {
      const [lights, devices, rooms, conn, scenes] = await Promise.all([
        this.get<HueLight>("light"),
        this.get<HueDevice>("device"),
        this.get<HueRoom>("room"),
        this.get<HueZigbeeConnectivity>("zigbee_connectivity"),
        this.get<HueScene>("scene"),
      ]);
      const known = new Set(this.lights.keys());
      this.lights = new Map(lights.map((l) => [l.id, l]));
      this.devices = new Map(devices.map((d) => [d.id, d]));
      this.rooms = new Map(rooms.map((r) => [r.id, r]));
      this.connectivity = new Map(conn.map((c) => [c.owner.rid, c.status]));
      this.scenes = scenes;
      this.lastOk = this.now();
      this.lastError = null;
      const changed = lights.length !== known.size || lights.some((l) => !known.has(l.id));
      if (changed) this.ctx?.emit({ type: "devices_changed" });
      for (const l of lights) this.ctx?.emit({ type: "device_state", externalId: l.id, report: this.report(l.id) });
      this.refreshedAt = Date.now();
      await this.persist();
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.ctx?.logger.warn("Hue-bridge niet bereikbaar", { bridge: this.config.bridgeId, error: this.lastError });
      for (const id of this.lights.keys()) this.ctx?.emit({ type: "device_state", externalId: id, report: this.report(id) });
    }
  }

  private async runEventStream(): Promise<void> {
    while (this.ctx && this.http) {
      this.abort = new AbortController();
      try {
        await this.http.stream("/eventstream/clip/v2", (data) => this.onEvent(data), this.abort.signal);
      } catch (err) {
        this.ctx?.logger.warn("Hue-eventstream onderbroken", { error: String(err) });
      }
      if (!this.ctx) return;
      await new Promise((r) => setTimeout(r, 5_000).unref?.());
    }
  }

  /** Verwerkt een eventstream-bericht (officieel formaat: lijst van {type:"update", data:[...]}) */
  onEvent(raw: string): void {
    let events: { type: string; data?: (Partial<HueLight> & { id: string; type: string; status?: string; owner?: { rid: string } })[] }[];
    try {
      events = JSON.parse(raw);
    } catch {
      return;
    }
    for (const ev of events) {
      if (ev.type !== "update") continue;
      for (const d of ev.data ?? []) {
        if (d.type === "light") {
          const cur = this.lights.get(d.id);
          if (!cur) continue;
          if (d.on) cur.on = d.on;
          if (d.dimming) cur.dimming = { ...cur.dimming, ...d.dimming };
          if (d.color) cur.color = { ...cur.color, ...d.color } as HueLight["color"];
          if (d.color_temperature) cur.color_temperature = { ...cur.color_temperature, ...d.color_temperature } as HueLight["color_temperature"];
          this.lastOk = this.now();
          this.ctx?.emit({ type: "device_state", externalId: d.id, report: this.report(d.id) });
        } else if (d.type === "zigbee_connectivity" && d.owner && d.status) {
          this.connectivity.set(d.owner.rid, d.status as HueZigbeeConnectivity["status"]);
          for (const l of this.lights.values()) if (l.owner.rid === d.owner.rid) this.ctx?.emit({ type: "device_state", externalId: l.id, report: this.report(l.id) });
        }
      }
    }
  }

  // ───────────── vertaling naar HomeOS ─────────────

  getCapabilities(externalId: string): Capability[] {
    const l = this.lights.get(externalId);
    if (!l) return [];
    const caps: Capability[] = ["onoff"];
    if (l.dimming) caps.push("brightness");
    if (l.color) caps.push("color");
    if (l.color_temperature?.mirek_schema) caps.push("color_temperature");
    return caps;
  }

  private roomOf(deviceId: string): HueRoom | undefined {
    for (const r of this.rooms.values()) if (r.children.some((c) => c.rid === deviceId)) return r;
    return undefined;
  }

  async discover(): Promise<DiscoveredDevice[]> {
    return [...this.lights.values()].map((l) => {
      const dev = this.devices.get(l.owner.rid);
      const room = this.roomOf(l.owner.rid);
      return {
        externalId: l.id,
        name: l.metadata.name || dev?.metadata.name || "Hue-lamp",
        brand: "Philips Hue",
        model: dev?.product_data?.product_name ?? dev?.product_data?.model_id ?? "",
        kind: "light" as const,
        capabilities: this.getCapabilities(l.id),
        suggestedRoomId: room ? roomSlug(room.metadata.name) : null,
      };
    });
  }

  private state(l: HueLight): DeviceState {
    const s: DeviceState = { on: l.on.on };
    if (l.dimming) s.brightness = Math.max(0, Math.min(100, Math.round(l.dimming.brightness)));
    if (l.color_temperature?.mirek && l.color_temperature.mirek_valid !== false) s.colorTempK = Math.min(10000, Math.max(1000, mirekToKelvin(l.color_temperature.mirek)));
    if (l.color?.xy) s.colorHex = xyToHex(l.color.xy);
    return s;
  }

  private report(externalId: string): StatusReport {
    const l = this.lights.get(externalId);
    if (!l) return { status: "UNKNOWN", state: {}, lastSeen: null, error: "Lamp niet gevonden op de bridge" };
    if (this.lastError) return { status: "ERROR", state: this.state(l), lastSeen: null, error: `Bridge: ${this.lastError}` };
    const conn = this.connectivity.get(l.owner.rid) ?? "connected";
    if (conn !== "connected") {
      return { status: "OFFLINE", state: this.state(l), lastSeen: null, error: conn === "connectivity_issue" ? "Lamp niet bereikbaar (stroom uit of buiten bereik)" : `Zigbee: ${conn}` };
    }
    return { status: "ONLINE", state: this.state(l), lastSeen: this.lastOk, error: null };
  }

  async getStatus(externalId: string): Promise<StatusReport> {
    return this.report(externalId);
  }

  // ───────────── opdrachten ─────────────

  private send<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      const wait = this.lastSend + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastSend = Date.now();
      return fn();
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private body(l: HueLight, c: DeviceCommand): Record<string, unknown> | null {
    switch (c.type) {
      case "set_power":
        return { on: { on: c.on } };
      case "set_brightness":
        return { on: { on: true }, dimming: { brightness: c.brightness } };
      case "set_color":
        return { on: { on: true }, color: { xy: hexToXy(c.colorHex, l.color?.gamut as Gamut | undefined) } };
      case "set_color_temperature": {
        const schema = l.color_temperature?.mirek_schema;
        const mirek = kelvinToMirek(c.colorTempK);
        return { on: { on: true }, color_temperature: { mirek: schema ? Math.min(schema.mirek_maximum, Math.max(schema.mirek_minimum, mirek)) : mirek } };
      }
      default:
        return null;
    }
  }

  async executeCommand(externalId: string, command: DeviceCommand): Promise<CommandResult> {
    const l = this.lights.get(externalId);
    if (!l || !this.http) return { ok: false, code: "NOT_FOUND", message: "Lamp niet gevonden op de bridge" };
    if (!this.getCapabilities(externalId).includes(COMMAND_CAPABILITY[command.type])) {
      return { ok: false, code: "UNSUPPORTED", message: "Deze lamp ondersteunt deze opdracht niet" };
    }
    const report = this.report(externalId);
    if (report.status !== "ONLINE") return { ok: false, code: "DEVICE_UNAVAILABLE", message: report.error ?? "Lamp niet bereikbaar" };
    const body = this.body(l, command);
    if (!body) return { ok: false, code: "UNSUPPORTED", message: "Opdracht niet ondersteund" };
    try {
      const res = await this.send(() => this.http!.request<HueList<unknown>>("PUT", `/clip/v2/resource/light/${encodeURIComponent(externalId)}`, body));
      if (res.status !== 200 || res.body?.errors?.length) {
        return { ok: false, code: "ADAPTER_ERROR", message: res.body?.errors?.[0]?.description ?? `Bridge gaf status ${res.status}` };
      }
      // Lees de werkelijke toestand terug; geen aanname dat de opdracht gelukt is.
      const fresh = await this.http.request<HueList<HueLight>>("GET", `/clip/v2/resource/light/${encodeURIComponent(externalId)}`);
      const updated = fresh.body?.data?.[0];
      if (updated) this.lights.set(externalId, updated);
      this.lastOk = this.now();
      await this.persist();
      return { ok: true, report: this.report(externalId) };
    } catch (err) {
      return { ok: false, code: "ADAPTER_ERROR", message: err instanceof Error ? err.message : "Bridge niet bereikbaar" };
    }
  }

  async getScenes() {
    return this.scenes
      .filter((s) => s.group.rtype === "room" || s.group.rtype === "zone")
      .map((s) => {
        const room = s.group.rtype === "room" ? this.rooms.get(s.group.rid) : undefined;
        return { id: s.id, name: room ? `${s.metadata.name} · ${room.metadata.name}` : s.metadata.name, roomId: room ? roomSlug(room.metadata.name) : null };
      });
  }

  async activateScene(sceneId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.http || !this.scenes.some((s) => s.id === sceneId)) return { ok: false, message: "Scène niet gevonden" };
    try {
      const res = await this.send(() => this.http!.request<HueList<unknown>>("PUT", `/clip/v2/resource/scene/${encodeURIComponent(sceneId)}`, { recall: { action: "active" } }));
      if (res.status !== 200 || res.body?.errors?.length) return { ok: false, message: res.body?.errors?.[0]?.description ?? `Status ${res.status}` };
      await this.refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Bridge niet bereikbaar" };
    }
  }

  async healthCheck(): Promise<AdapterHealth> {
    return {
      adapterId: this.id,
      integration: this.integration,
      displayName: this.displayName,
      demo: false,
      status: !this.http ? "not_configured" : this.lastError ? "down" : "ok",
      message: !this.http ? "Niet gekoppeld" : this.lastError ?? `${this.lights.size} lampen · ${this.config.host}`,
      checkedAt: this.now(),
    };
  }

  private now() {
    return (this.ctx?.now() ?? new Date()).toISOString();
  }
}

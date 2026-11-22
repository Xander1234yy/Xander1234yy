import type { AdapterHealth, Capability, DeviceCommand, DeviceState } from "@homeos/shared";
import type { AdapterContext, CommandResult, DeviceAdapter, DiscoveredDevice, StatusReport } from "../adapter";
import { RequestBudget } from "../cloud/budget";
import { TapoCloudClient, TapoCloudError, httpsTapo, type TapoCamera, type TapoHttp } from "./client";
import { relayStream, requestRelay, type RelaySocket } from "./relay";

/**
 * Tapo-camera's en -deurbel via de TP-Link-cloud — NIET-OFFICIEEL (expliciet gevraagd door de gebruiker).
 * - Meldingen (beweging, persoon, deurbel) uit de meldingengeschiedenis van de Tapo-app, hooguit elke minuut.
 * - Privacymodus aan/uit als "camera aan/uit" (aan = camera kijkt), met teruglezen.
 * - Draaien (pan/tilt) via de IoT-app-server.
 * - Live beeld via het videorelais (zie relay.ts), alleen op verzoek van een lid en maximaal 4 minuten.
 * Verbindingen alleen met TP-Link-hosts.
 */
const POLL_MS = 60_000;
const PRIVACY_MS = 10 * 60_000;
/** Bij de eerste keer ophalen niet alle oude meldingen als nieuw melden. */
const BASELINE_MS = 60 * 60_000;
const EMIT_MAX_AGE_MS = 15 * 60_000;
const STEP = 10;

interface Session {
  base: string;
  token: string;
  refreshToken: string | null;
  iotBase?: string;
  cipcBase?: string;
}
interface Cache {
  since?: number;
  lastMotion?: Record<string, string>;
  lastMotionKind?: Record<string, string>;
  lastRing?: Record<string, string>;
  privacy?: Record<string, { enabled: boolean; at: string }>;
  lastPoll?: number;
  lastPrivacyPoll?: number;
  lastError?: string | null;
  budget?: unknown;
  /** Diagnose: type en sleutels van de laatste meldingen (geen inhoud, geen afbeeldingen). */
  recentTypes?: { at: string; msgType: string; known: boolean; keys: string[] }[];
}

export interface TapoCloudConfig {
  cameras: TapoCamera[];
}

export class TapoCloudAdapter implements DeviceAdapter {
  readonly integration = "tapo_camera" as const;
  readonly demo = false;
  readonly id = "tapocloud";
  readonly displayName = "Tapo-camera's via TP-Link-cloud (niet-officieel)";
  readonly budget: RequestBudget;

  private ctx: AdapterContext | null = null;
  private client: TapoCloudClient | null = null;
  private creds: { email: string; password: string } | null = null;
  private session: Session | null = null;
  private c: Cache = {};
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly config: TapoCloudConfig,
    private readonly http: TapoHttp = httpsTapo,
    private readonly nowMs: () => number = Date.now,
    private readonly relaySocket?: RelaySocket,
  ) {
    this.budget = new RequestBudget(3000, 300, nowMs);
  }

  async connect(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    const terminal = await ctx.secrets.get("terminalUUID");
    const creds = await ctx.secrets.get("credentials");
    const session = await ctx.secrets.get("session");
    this.creds = creds ? (JSON.parse(creds) as { email: string; password: string }) : null;
    this.session = session ? (JSON.parse(session) as Session) : null;
    if (terminal) this.client = new TapoCloudClient(terminal, this.http);
    this.c = ((await ctx.cache?.load()) as Cache | null) ?? {};
    this.budget.importState(this.c.budget);
    if (!this.configured()) return;
    if (ctx.serverless) {
      await this.poll(false);
      return;
    }
    await this.poll(true);
    this.timer = setInterval(() => void this.poll(false), POLL_MS);
    this.timer.unref?.();
  }

  /** Alleen de aanmelding laden (voor live beeld), zonder meldingen op te halen. */
  async prepare(secrets: AdapterContext["secrets"]): Promise<void> {
    this.ctx = { logger: { info() {}, warn() {}, error() {} }, now: () => new Date(this.nowMs()), emit() {}, secrets, serverless: true };
    const terminal = await secrets.get("terminalUUID");
    const creds = await secrets.get("credentials");
    const session = await secrets.get("session");
    this.creds = creds ? (JSON.parse(creds) as { email: string; password: string }) : null;
    this.session = session ? (JSON.parse(session) as Session) : null;
    if (terminal) this.client = new TapoCloudClient(terminal, this.http);
  }

  /**
   * Live beeld (MPEG-TS met H.264) via het videorelais van de TP-Link-cloud. Een verlopen aanmelding wordt vóór het
   * openen van het relais vernieuwd; daarna stroomt het beeld tot `signal` afbreekt of `maxMs` verstreken is.
   */
  async openLive(deviceId: string, o: { signal?: AbortSignal; maxMs?: number; resolution?: "HD" | "VGA" } = {}): Promise<AsyncGenerator<Buffer>> {
    const cam = this.config.cameras.find((c) => c.deviceId === deviceId);
    if (!cam) throw new TapoCloudError("Camera niet gevonden", "CAMERA");
    const relay = await this.withSession("command", async (s) => {
      if (!s.cipcBase) {
        s.cipcBase = await this.client!.serviceUrl(s.base, s.token, "cipc.api.cloud");
        this.session = s;
        await this.ctx?.secrets.set("session", JSON.stringify(s));
      }
      return requestRelay({ cipc: s.cipcBase, token: s.token, deviceId, playerId: this.client!.terminalUUID, resolution: o.resolution ?? "HD", deviceType: cam.type === "doorbell" ? "SMART.TAPODOORBELL" : "SMART.IPCAMERA", http: this.http });
    });
    return relayStream({ relay, resolution: o.resolution ?? "HD", ...(o.signal ? { signal: o.signal } : {}), maxMs: o.maxMs ?? 240_000, ...(this.relaySocket ? { socket: this.relaySocket } : {}) });
  }

  /** Geluidsformaat van de microfoon (G.711 A-law/µ-law), of null als onbekend, gedempt of niet ondersteund. */
  async audioInfo(deviceId: string): Promise<{ codec: "alaw" | "mulaw"; rate: number } | null> {
    try {
      const r = await this.withSession("command", async (s) =>
        this.client!.cameraCall(await this.iotBase(s), s.token, deviceId, "getAudioConfig", { audio_config: { name: ["speaker", "microphone"] }, audio_capability: { name: ["device_microphone"] } }),
      );
      const mic = (r.audio_config as { microphone?: { encode_type?: string; sampling_rate?: string; mute?: string } } | undefined)?.microphone;
      const codec = mic?.encode_type === "G711alaw" ? "alaw" : mic?.encode_type === "G711ulaw" ? "mulaw" : null;
      if (!codec || mic?.mute === "on") return null;
      let rate = Number.parseInt(String(mic?.sampling_rate ?? "8"), 10) || 8;
      if (rate < 1000) rate *= 1000;
      return { codec, rate: Math.min(48_000, Math.max(8_000, rate)) };
    } catch {
      return null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.ctx = null;
  }

  private configured() {
    return !!(this.client && this.session);
  }

  private async persist() {
    this.c.budget = this.budget.exportState();
    await this.ctx?.cache?.save(this.c);
  }

  /** Voert `fn` uit met een geldige sessie; vernieuwt of meldt opnieuw aan bij een verlopen token (zonder verificatiecode). */
  private async withSession<T>(kind: "background" | "command", fn: (s: Session) => Promise<T>): Promise<T> {
    if (!this.client || !this.session) throw new TapoCloudError("Niet gekoppeld met TP-Link", "UNAUTHORIZED");
    if (!this.budget.canSpend(kind)) throw new TapoCloudError("Daglimiet van HomeOS voor TP-Link bereikt", "UNAVAILABLE");
    this.budget.spend();
    try {
      return await fn(this.session);
    } catch (e) {
      if (!(e instanceof TapoCloudError) || e.code !== "EXPIRED") throw e;
      let next: Session | null = null;
      if (this.session.refreshToken) {
        try {
          const r = await this.client.refresh(this.session.base, this.session.refreshToken);
          next = { ...this.session, token: r.token, refreshToken: r.refreshToken };
        } catch {
          next = null;
        }
      }
      if (!next && this.creds) {
        const r = await this.client.login(this.creds.email, this.creds.password);
        if (r.kind === "mfa") throw new TapoCloudError("TP-Link vraagt een nieuwe verificatiecode: koppel opnieuw bij Instellingen", "UNAUTHORIZED");
        next = { base: r.base, token: r.token, refreshToken: r.refreshToken, ...(this.session.iotBase ? { iotBase: this.session.iotBase } : {}) };
      }
      if (!next) throw e;
      this.session = next;
      await this.ctx?.secrets.set("session", JSON.stringify(next));
      return fn(next);
    }
  }

  private async iotBase(s: Session): Promise<string> {
    if (s.iotBase) return s.iotBase;
    const url = await this.client!.serviceUrl(s.base, s.token, "nbu.iot-app-server.app");
    s.iotBase = url;
    this.session = s;
    await this.ctx?.secrets.set("session", JSON.stringify(s));
    return url;
  }

  private async poll(force: boolean): Promise<void> {
    if (!this.configured()) return;
    const now = this.nowMs();
    if (!force && now - (this.c.lastPoll ?? 0) < POLL_MS) return;
    this.c.lastPoll = now;
    const first = this.c.since === undefined;
    const since = this.c.since ?? now - BASELINE_MS;
    try {
      const list = await this.withSession("background", (s) => this.client!.notifications(s.base, s.token, since, 4, (raw) => {
        const att = raw.attachments;
        const keys = [...Object.keys(raw), ...(att && typeof att === "object" ? Object.keys(att as object).map((k) => `attachments.${k}`) : typeof att === "string" ? ["attachments(json)"] : [])].slice(0, 20);
        this.c.recentTypes = [{ at: new Date(this.nowMs()).toISOString(), msgType: String(raw.msgType ?? "?").slice(0, 60), known: true, keys }, ...(this.c.recentTypes ?? [])].slice(0, 10);
      }));
      const known = new Set(this.config.cameras.map((c) => c.deviceId));
      let newest = since;
      for (const n of list) {
        if (!known.has(n.deviceId) || n.kind === "other") {
          if (this.c.recentTypes?.[0]) this.c.recentTypes[0].known = false;
          continue;
        }
        const t = Date.parse(n.at);
        if (t <= since) continue;
        newest = Math.max(newest, t);
        if (n.kind === "ring") this.c.lastRing = { ...this.c.lastRing, [n.deviceId]: n.at };
        else {
          this.c.lastMotion = { ...this.c.lastMotion, [n.deviceId]: n.at };
          this.c.lastMotionKind = { ...this.c.lastMotionKind, [n.deviceId]: n.kind };
        }
        if (!first && now - t <= EMIT_MAX_AGE_MS) {
          const name = this.config.cameras.find((c) => c.deviceId === n.deviceId)?.name ?? "camera";
          this.ctx?.emit({
            type: "device_event",
            externalId: n.deviceId,
            event: n.kind === "ring" ? { type: "doorbell_ring", at: n.at, message: `Er wordt aangebeld (${name})` } : { type: "motion", at: n.at, message: n.kind === "person" ? `Persoon gezien bij ${name}` : `Beweging bij ${name}` },
          });
        }
      }
      this.c.since = Math.max(newest, first ? now - 60_000 : since);
      if (now - (this.c.lastPrivacyPoll ?? 0) >= PRIVACY_MS) {
        this.c.lastPrivacyPoll = now;
        for (const cam of this.config.cameras.filter((x) => x.type === "camera")) {
          try {
            await this.readPrivacy(cam.deviceId, "background");
          } catch {
            /* camera offline of niet ondersteund: laatste stand houden */
          }
        }
      }
      this.c.lastError = null;
    } catch (e) {
      this.c.lastError = (e as Error).message;
      this.ctx?.logger.warn("Tapo-cloud verversen mislukt", { error: this.c.lastError });
    }
    for (const cam of this.config.cameras) this.ctx?.emit({ type: "device_state", externalId: cam.deviceId, report: this.report(cam.deviceId) });
    await this.persist();
  }

  private async readPrivacy(deviceId: string, kind: "background" | "command"): Promise<boolean> {
    const r = await this.withSession(kind, async (s) => this.client!.cameraCall(await this.iotBase(s), s.token, deviceId, "getLensMaskConfig", { lens_mask: { name: ["lens_mask_info"] } }));
    const info = (r.lens_mask as { lens_mask_info?: { enabled?: string } } | undefined)?.lens_mask_info;
    const enabled = info?.enabled === "on";
    this.c.privacy = { ...this.c.privacy, [deviceId]: { enabled, at: new Date(this.nowMs()).toISOString() } };
    return enabled;
  }

  getCapabilities(externalId: string): Capability[] {
    const cam = this.config.cameras.find((c) => c.deviceId === externalId);
    if (!cam) return [];
    return cam.type === "doorbell" ? ["motion", "doorbell", "cloud_stream"] : ["motion", "onoff", "ptz", "cloud_stream"];
  }

  async discover(): Promise<DiscoveredDevice[]> {
    return this.config.cameras.map((c) => ({
      externalId: c.deviceId,
      name: c.name,
      brand: "TP-Link Tapo (cloud, niet-officieel)",
      model: c.model || (c.type === "doorbell" ? "Deurbel" : "Camera"),
      kind: c.type === "doorbell" ? ("doorbell" as const) : ("camera" as const),
      capabilities: this.getCapabilities(c.deviceId),
      suggestedRoomId: null,
      refreshIntervalMs: POLL_MS,
    }));
  }

  private state(id: string): DeviceState {
    const st: DeviceState = {};
    const motion = this.c.lastMotion?.[id];
    if (motion) st.lastMotionAt = motion;
    const ring = this.c.lastRing?.[id];
    if (ring) st.lastRingAt = ring;
    const p = this.c.privacy?.[id];
    if (p) st.on = !p.enabled;
    return st;
  }

  private report(id: string): StatusReport {
    if (!this.config.cameras.some((c) => c.deviceId === id)) return { status: "UNKNOWN", state: {}, lastSeen: null, error: "Camera niet gevonden" };
    if (!this.configured()) return { status: "UNKNOWN", state: {}, lastSeen: null, error: "Niet gekoppeld met TP-Link" };
    const p = this.c.privacy?.[id];
    // TP-Link meldt de online-status van camera's niet betrouwbaar; een geslaagde opdracht of uitlezing is het enige bewijs.
    return { status: "ONLINE", state: this.state(id), lastSeen: p?.at ?? null, error: this.c.lastError ?? null, stateAt: p?.at ?? null };
  }

  async getStatus(id: string): Promise<StatusReport> {
    await this.poll(false);
    return this.report(id);
  }

  async executeCommand(id: string, command: DeviceCommand): Promise<CommandResult> {
    const cam = this.config.cameras.find((c) => c.deviceId === id);
    if (!cam) return { ok: false, code: "NOT_FOUND", message: "Camera niet gevonden" };
    if (!this.configured()) return { ok: false, code: "DEVICE_UNAVAILABLE", message: "Niet gekoppeld met TP-Link" };
    if (cam.type !== "camera") return { ok: false, code: "UNSUPPORTED", message: "Deze deurbel ondersteunt geen bediening via HomeOS" };
    try {
      if (command.type === "set_power") {
        const want = command.on ? "off" : "on"; // camera aan = privacymodus uit
        await this.withSession("command", async (s) => this.client!.cameraCall(await this.iotBase(s), s.token, id, "setLensMaskConfig", { lens_mask: { lens_mask_info: { enabled: want } } }));
        // De camera past de privacymodus asynchroon toe: kort teruglezen.
        for (let i = 0; i < 3; i++) {
          if ((await this.readPrivacy(id, "command")) === (want === "on")) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
      } else if (command.type === "ptz_move") {
        const [x, y] = { left: [-STEP, 0], right: [STEP, 0], up: [0, STEP], down: [0, -STEP] }[command.direction];
        await this.withSession("command", async (s) => this.client!.cameraCall(await this.iotBase(s), s.token, id, "motorMove", { motor: { move: { x_coord: String(x), y_coord: String(y) } } }));
      } else {
        return { ok: false, code: "UNSUPPORTED", message: "Dit kan HomeOS niet via de TP-Link-cloud" };
      }
      this.c.lastError = null;
      await this.persist();
      return { ok: true, report: this.report(id) };
    } catch (e) {
      const err = e as TapoCloudError;
      await this.persist();
      return { ok: false, code: err.code === "UNAUTHORIZED" || err.code === "UNAVAILABLE" || err.code === "CAMERA" ? "DEVICE_UNAVAILABLE" : "ADAPTER_ERROR", message: err.message };
    }
  }

  async healthCheck(): Promise<AdapterHealth> {
    return {
      adapterId: this.id,
      integration: this.integration,
      displayName: this.displayName,
      demo: false,
      status: !this.configured() ? "not_configured" : this.c.lastError ? "degraded" : "ok",
      message: !this.configured() ? "Niet gekoppeld" : (this.c.lastError ?? `${this.config.cameras.length} camera('s) · meldingen elke minuut · niet-officieel, kan zonder aankondiging stoppen`),
      checkedAt: new Date(this.nowMs()).toISOString(),
    };
  }
}

import type { AdapterHealth, Capability, DeviceCommand } from "@homeos/shared";
import type { AdapterContext, CommandResult, DeviceAdapter, DiscoveredDevice, StatusReport } from "../adapter";
import { OnvifClient, OnvifError, type OnvifOptions } from "./onvif";

export interface TapoCameraConfig {
  cameraId: string;
  host: string;
  name: string;
  model: string;
  onvifPort?: number;
  rtspPort?: number;
}

const EXTERNAL_ID = "camera";
const POLL_MS = 60_000;
const MOTION_COOLDOWN_MS = 30_000;

/**
 * Tapo-camera via de officiële lokale koppelingen voor recorders van derden: ONVIF (status, beweging, draaien) en
 * RTSP (beeld, zie stream.ts). Werkt alleen bij camera's op netstroom met een camera-account uit de Tapo-app.
 * Camera's zijn privacygevoelig: Jarvis en automatiseringen kunnen ze niet bedienen (SAFETY_CRITICAL_KINDS).
 */
export class TapoCameraAdapter implements DeviceAdapter {
  readonly integration = "tapo_camera" as const;
  readonly demo = false;
  readonly id: string;
  readonly displayName: string;

  private ctx: AdapterContext | null = null;
  private onvif: OnvifClient | null = null;
  private creds: { username: string; password: string } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  private online = false;
  private lastOk: string | null = null;
  private lastError: string | null = null;
  private ptz = false;
  private lastMotionAt: string | null = null;
  private lastMotionEmit = 0;
  private pullAddress: string | null = null;

  constructor(
    readonly config: TapoCameraConfig,
    private readonly deps: { fetchImpl?: typeof fetch; eventsRetryMs?: number; pullTimeoutSec?: number } = {},
  ) {
    this.id = `tapo-${config.cameraId.slice(-6)}`;
    this.displayName = `Tapo-camera (${config.name})`;
  }

  async connect(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    this.stopped = false;
    const [username, password] = await Promise.all([ctx.secrets.get("username"), ctx.secrets.get("password")]);
    if (!username || !password) {
      this.lastError = "Geen camera-account: voeg de camera opnieuw toe";
      return;
    }
    this.creds = { username, password };
    const opts: OnvifOptions = { host: this.config.host, port: this.config.onvifPort ?? 2020, username, password, ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}) };
    this.onvif = new OnvifClient(opts);
    await this.refresh(true);
    this.timer = setInterval(() => void this.refresh(false), POLL_MS);
    this.timer.unref?.();
    void this.eventLoop();
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.pullAddress && this.onvif) await this.onvif.unsubscribe(this.pullAddress);
    this.pullAddress = null;
    this.ctx = null;
  }

  /** RTSP-adres met inloggegevens. Alleen voor de connector (ffmpeg); gaat nooit naar de browser of de cloud. */
  rtspUrl(quality: "high" | "low" = "low"): string | null {
    if (!this.creds) return null;
    const e = encodeURIComponent;
    return `rtsp://${e(this.creds.username)}:${e(this.creds.password)}@${this.config.host}:${this.config.rtspPort ?? 554}/${quality === "high" ? "stream1" : "stream2"}`;
  }

  private async refresh(full: boolean) {
    if (!this.onvif) return;
    try {
      await this.onvif.syncTime();
      if (full) {
        await this.onvif.deviceInformation();
        const caps = await this.onvif.capabilities();
        this.ptz = !!caps.ptz;
      }
      this.online = true;
      this.lastError = null;
      this.lastOk = this.now();
    } catch (e) {
      this.online = false;
      const err = e as OnvifError;
      this.lastError = err.code === "UNREACHABLE" || err.code === "TIMEOUT" ? null : err.message;
    }
    this.emitState();
  }

  private async eventLoop() {
    const retry = this.deps.eventsRetryMs ?? 30_000;
    let renewAt = 0;
    while (!this.stopped && this.onvif) {
      try {
        if (!this.pullAddress) {
          this.pullAddress = await this.onvif.createPullPoint();
          renewAt = Date.now() + 5 * 60_000;
        }
        if (Date.now() > renewAt) {
          await this.onvif.renew(this.pullAddress);
          renewAt = Date.now() + 5 * 60_000;
        }
        const events = await this.onvif.pullMessages(this.pullAddress, this.deps.pullTimeoutSec ?? 10);
        for (const ev of events) if (ev.active && ev.kind !== "other") this.onMotion(ev.kind);
      } catch {
        this.pullAddress = null;
        if (this.stopped) return;
        await new Promise((r) => setTimeout(r, retry).unref?.());
      }
    }
  }

  private onMotion(kind: "motion" | "person") {
    const now = this.ctx?.now() ?? new Date();
    this.lastMotionAt = now.toISOString();
    this.emitState();
    if (now.getTime() - this.lastMotionEmit < MOTION_COOLDOWN_MS) return;
    this.lastMotionEmit = now.getTime();
    this.ctx?.emit({
      type: "device_event",
      externalId: EXTERNAL_ID,
      event: { type: "motion", at: now.toISOString(), message: kind === "person" ? `Persoon gezien bij ${this.config.name}` : `Beweging bij ${this.config.name}` },
    });
  }

  private emitState() {
    this.ctx?.emit({ type: "device_state", externalId: EXTERNAL_ID, report: this.report() });
  }

  private report(): StatusReport {
    return {
      status: this.lastError ? "ERROR" : this.online ? "ONLINE" : this.creds ? "OFFLINE" : "ERROR",
      state: this.lastMotionAt ? { lastMotionAt: this.lastMotionAt } : {},
      lastSeen: this.lastOk,
      error: this.lastError,
    };
  }

  async discover(): Promise<DiscoveredDevice[]> {
    return [{ externalId: EXTERNAL_ID, name: this.config.name, brand: "TP-Link Tapo", model: this.config.model, kind: "camera", capabilities: this.getCapabilities(EXTERNAL_ID), suggestedRoomId: null }];
  }

  getCapabilities(_externalId: string): Capability[] {
    return this.ptz ? ["camera_stream", "motion", "ptz"] : ["camera_stream", "motion"];
  }

  async getStatus(externalId: string): Promise<StatusReport> {
    if (externalId !== EXTERNAL_ID) return { status: "UNKNOWN", state: {}, lastSeen: null, error: "Onbekend apparaat" };
    return this.report();
  }

  async executeCommand(externalId: string, command: DeviceCommand): Promise<CommandResult> {
    if (externalId !== EXTERNAL_ID) return { ok: false, code: "NOT_FOUND", message: "Onbekend apparaat" };
    if (command.type !== "ptz_move" || !this.ptz) return { ok: false, code: "UNSUPPORTED", message: "Niet ondersteund door deze camera" };
    if (!this.onvif || !this.online) return { ok: false, code: "DEVICE_UNAVAILABLE", message: "Camera niet bereikbaar" };
    try {
      await this.onvif.ptzNudge(command.direction);
    } catch (e) {
      return { ok: false, code: "ADAPTER_ERROR", message: (e as Error).message };
    }
    return { ok: true, report: this.report() };
  }

  async healthCheck(): Promise<AdapterHealth> {
    return {
      adapterId: this.id,
      integration: this.integration,
      displayName: this.displayName,
      demo: false,
      status: !this.creds ? "not_configured" : this.lastError ? "down" : this.online ? "ok" : "degraded",
      message: !this.creds ? "Geen camera-account" : (this.lastError ?? (this.online ? `Verbonden · ${this.config.host}` : "Camera niet bereikbaar")),
      checkedAt: this.now(),
    };
  }

  private now() {
    return (this.ctx?.now() ?? new Date()).toISOString();
  }
}

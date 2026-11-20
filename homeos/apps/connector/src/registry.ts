import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  checkCommand,
  type AdapterHealth,
  type CommandErrorCode,
  type CommandSource,
  type Device,
  type DeviceCommand,
  type DeviceEvent,
  type EnergyHistory,
  type EnergyRange,
  type EnergySummary,
  type Room,
  type Scene,
  type Snapshot,
} from "@homeos/shared";
import type { AdapterEvent, DeviceAdapter, DiscoveredDevice, Logger, StatusReport } from "@homeos/integrations";
import type { Journal } from "./journal";
import type { SecretStore } from "./secret-store";
import type { StateStore } from "./state-store";

interface Record_ {
  id: string;
  adapter: DeviceAdapter;
  info: DiscoveredDevice;
  status: Device["status"];
  state: Device["state"];
  lastSeen: string | null;
  stateUpdatedAt: string | null;
  error: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  source: CommandSource | "system";
  target: string | null;
  detail: unknown;
  ok: boolean;
  message?: string;
}

export type OpResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { value: T }))
  | { ok: false; code: CommandErrorCode; message: string };

export interface RegistryOptions {
  connectorId: string;
  version: string;
  demoMode: boolean;
  adapters: DeviceAdapter[];
  store: StateStore;
  secrets: SecretStore;
  audit: Journal<AuditEntry>;
  events: Journal<DeviceEvent>;
  logger: Logger;
  pollIntervalMs: number;
  now?: () => Date;
}

const deviceId = (adapter: DeviceAdapter, externalId: string) => `${adapter.id}:${externalId}`;

/**
 * Centrale apparaatregistry van de connector: kent alle adapters, houdt de statuscache bij,
 * controleert iedere opdracht en legt alles vast in het auditlog.
 */
export class DeviceRegistry extends EventEmitter {
  private readonly records = new Map<string, Record_>();
  private readonly health = new Map<string, AdapterHealth>();
  private scenes: Scene[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly startedAt: string;
  private readonly now: () => Date;

  constructor(private readonly o: RegistryOptions) {
    super();
    this.now = o.now ?? (() => new Date());
    this.startedAt = this.now().toISOString();
  }

  // ---------- levenscyclus ----------

  async start(): Promise<void> {
    for (const adapter of this.o.adapters) {
      try {
        await adapter.connect({
          logger: this.o.logger,
          now: this.now,
          emit: (e) => this.onAdapterEvent(adapter, e),
          secrets: this.o.secrets.scoped(adapter.id),
        });
        await this.discoverAdapter(adapter);
      } catch (err) {
        this.o.logger.error("Adapter kon niet verbinden", { adapter: adapter.id, error: String(err) });
        this.health.set(adapter.id, this.downHealth(adapter, `Verbinden mislukt: ${String(err)}`));
      }
    }
    if (this.o.demoMode && !this.o.store.state.demoSeeded) {
      for (const r of this.records.values()) {
        if (r.adapter.demo) this.o.store.state.devices[r.id] = { addedAt: this.now().toISOString(), roomId: r.info.suggestedRoomId };
      }
      this.o.store.state.demoSeeded = true;
      await this.o.store.save();
    }
    await this.syncAll("system");
    this.pollTimer = setInterval(() => void this.syncAll("system"), this.o.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.emitTimer) clearTimeout(this.emitTimer);
    for (const a of this.o.adapters) await a.disconnect().catch(() => undefined);
  }

  private async discoverAdapter(adapter: DeviceAdapter): Promise<void> {
    const found = await adapter.discover();
    for (const info of found) {
      const id = deviceId(adapter, info.externalId);
      const existing = this.records.get(id);
      if (existing) existing.info = info;
      else
        this.records.set(id, { id, adapter, info, status: "CONNECTING", state: {}, lastSeen: null, stateUpdatedAt: null, error: null });
    }
    if (adapter.getScenes) {
      const scenes = await adapter.getScenes();
      this.scenes = [
        ...this.scenes.filter((s) => s.adapterId !== adapter.id),
        ...scenes.map((s) => ({ ...s, id: `${adapter.id}:${s.id}`, adapterId: adapter.id, demo: adapter.demo })),
      ];
    }
    this.health.set(adapter.id, await adapter.healthCheck());
  }

  // ---------- status ----------

  private isAdded(id: string): boolean {
    return id in this.o.store.state.devices;
  }

  private applyReport(r: Record_, report: StatusReport): void {
    const prevStatus = r.status;
    r.status = report.status;
    r.error = report.error;
    if (report.lastSeen) r.lastSeen = report.lastSeen;
    if (report.status === "ONLINE") {
      r.state = report.state;
      r.stateUpdatedAt = this.now().toISOString();
    }
    if (prevStatus !== r.status && prevStatus !== "CONNECTING" && this.isAdded(r.id)) {
      this.recordEvent(r.id, "status_change", `${this.displayName(r)}: ${prevStatus} → ${r.status}`, r.adapter.demo);
    }
  }

  async syncDevice(id: string, source: CommandSource | "system" = "user"): Promise<OpResult> {
    const r = this.records.get(id);
    if (!r || !this.isAdded(id)) return { ok: false, code: "NOT_FOUND", message: "Apparaat niet gevonden" };
    try {
      this.applyReport(r, await r.adapter.getStatus(r.info.externalId));
    } catch (err) {
      r.status = "ERROR";
      r.error = `Uitlezen mislukt: ${String(err)}`;
    }
    if (source !== "system") this.audit("device.sync", source, id, null, true);
    this.scheduleEmit();
    return { ok: true };
  }

  async syncAll(source: CommandSource | "system" = "user"): Promise<void> {
    for (const a of this.o.adapters) {
      try {
        this.health.set(a.id, await a.healthCheck());
      } catch (err) {
        this.health.set(a.id, this.downHealth(a, String(err)));
      }
    }
    await Promise.all([...this.records.keys()].filter((id) => this.isAdded(id)).map((id) => this.syncDevice(id, "system")));
    if (source !== "system") this.audit("sync.all", source, null, null, true);
  }

  private onAdapterEvent(adapter: DeviceAdapter, e: AdapterEvent): void {
    if (e.type === "devices_changed") {
      void this.discoverAdapter(adapter).then(() => this.scheduleEmit());
      return;
    }
    const id = deviceId(adapter, e.externalId);
    const r = this.records.get(id);
    if (!r) return;
    if (e.type === "device_state") {
      this.applyReport(r, e.report);
      if (this.isAdded(id)) this.scheduleEmit();
    } else if (e.type === "device_event" && this.isAdded(id)) {
      this.recordEvent(id, e.event.type, e.event.message, adapter.demo, e.event.at);
    }
  }

  private recordEvent(deviceIdValue: string, type: DeviceEvent["type"], message: string, demo: boolean, at?: string): void {
    const ev: DeviceEvent = { id: randomUUID(), deviceId: deviceIdValue, type, at: at ?? this.now().toISOString(), message, demo };
    this.o.events.append(ev);
    this.emit("event", ev);
  }

  private scheduleEmit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit("snapshot", this.snapshot());
    }, 100);
    this.emitTimer.unref?.();
  }

  // ---------- leesmodel ----------

  private displayName(r: Record_): string {
    return this.o.store.state.devices[r.id]?.name ?? r.info.name;
  }

  private toDevice(r: Record_): Device {
    const p = this.o.store.state.devices[r.id];
    return {
      id: r.id,
      name: p?.name ?? r.info.name,
      brand: r.info.brand,
      model: r.info.model,
      kind: r.info.kind,
      roomId: p?.roomId ?? null,
      integration: r.adapter.integration,
      adapterId: r.adapter.id,
      status: r.status,
      lastSeen: r.lastSeen,
      stateUpdatedAt: r.stateUpdatedAt,
      capabilities: [...r.info.capabilities],
      state: r.state,
      error: r.error,
      demo: r.adapter.demo,
    };
  }

  getDevice(id: string): Device | null {
    const r = this.records.get(id);
    return r && this.isAdded(id) ? this.toDevice(r) : null;
  }

  snapshot(): Snapshot {
    return {
      generatedAt: this.now().toISOString(),
      connector: {
        connectorId: this.o.connectorId,
        version: this.o.version,
        startedAt: this.startedAt,
        demoMode: this.o.demoMode,
        emergencyStop: this.o.store.state.emergencyStop,
        adapters: [...this.health.values()],
      },
      devices: [...this.records.values()].filter((r) => this.isAdded(r.id)).map((r) => this.toDevice(r)),
      rooms: [...this.o.store.state.rooms].sort((a, b) => a.order - b.order),
      scenes: this.scenes,
    };
  }

  /** Gevonden maar nog niet toegevoegde apparaten. */
  available() {
    return [...this.records.values()]
      .filter((r) => !this.isAdded(r.id))
      .map((r) => ({ id: r.id, ...r.info, adapterId: r.adapter.id, integration: r.adapter.integration, demo: r.adapter.demo }));
  }

  events(limit = 50): DeviceEvent[] {
    return this.o.events.latest(limit);
  }

  auditLog(limit = 100): AuditEntry[] {
    return this.o.audit.latest(limit);
  }

  // ---------- beheer ----------

  async addDevice(id: string, input: { name?: string; roomId?: string | null }, source: CommandSource = "user"): Promise<OpResult> {
    const r = this.records.get(id);
    if (!r) return { ok: false, code: "NOT_FOUND", message: "Apparaat niet gevonden. Zoek eerst opnieuw." };
    if (input.roomId && !this.roomExists(input.roomId)) return { ok: false, code: "INVALID", message: "Onbekende kamer" };
    this.o.store.state.devices[id] = {
      addedAt: this.now().toISOString(),
      roomId: input.roomId ?? r.info.suggestedRoomId,
      ...(input.name ? { name: input.name } : {}),
    };
    await this.o.store.save();
    this.audit("device.add", source, id, input, true);
    await this.syncDevice(id, "system");
    return { ok: true };
  }

  async updateDevice(id: string, patch: { name?: string; roomId?: string | null }, source: CommandSource = "user"): Promise<OpResult> {
    const p = this.o.store.state.devices[id];
    if (!p) return { ok: false, code: "NOT_FOUND", message: "Apparaat niet gevonden" };
    if (patch.roomId && !this.roomExists(patch.roomId)) return { ok: false, code: "INVALID", message: "Onbekende kamer" };
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.roomId !== undefined) p.roomId = patch.roomId;
    await this.o.store.save();
    this.audit("device.update", source, id, patch, true);
    this.scheduleEmit();
    return { ok: true };
  }

  async removeDevice(id: string, source: CommandSource = "user"): Promise<OpResult> {
    if (!this.o.store.state.devices[id]) return { ok: false, code: "NOT_FOUND", message: "Apparaat niet gevonden" };
    delete this.o.store.state.devices[id];
    await this.o.store.save();
    this.audit("device.remove", source, id, null, true);
    this.scheduleEmit();
    return { ok: true };
  }

  async rediscover(source: CommandSource = "user"): Promise<void> {
    for (const a of this.o.adapters) {
      try {
        await this.discoverAdapter(a);
      } catch (err) {
        this.health.set(a.id, this.downHealth(a, String(err)));
      }
    }
    this.audit("discover", source, null, null, true);
    this.scheduleEmit();
  }

  // ---------- kamers ----------

  private roomExists(id: string) {
    return this.o.store.state.rooms.some((r) => r.id === id);
  }

  async createRoom(input: { name: string; icon?: string }): Promise<OpResult<Room>> {
    const base = slug(input.name) || "kamer";
    let id = base;
    for (let i = 2; this.roomExists(id); i++) id = `${base}-${i}`;
    const rooms = this.o.store.state.rooms;
    const room: Room = { id, name: input.name, icon: input.icon ?? "door-open", order: Math.max(-1, ...rooms.map((r) => r.order)) + 1 };
    rooms.push(room);
    await this.o.store.save();
    this.audit("room.create", "user", id, input, true);
    this.scheduleEmit();
    return { ok: true, value: room };
  }

  async updateRoom(id: string, input: { name: string; icon?: string }): Promise<OpResult> {
    const room = this.o.store.state.rooms.find((r) => r.id === id);
    if (!room) return { ok: false, code: "NOT_FOUND", message: "Kamer niet gevonden" };
    room.name = input.name;
    if (input.icon) room.icon = input.icon;
    await this.o.store.save();
    this.audit("room.update", "user", id, input, true);
    this.scheduleEmit();
    return { ok: true };
  }

  async deleteRoom(id: string): Promise<OpResult> {
    const s = this.o.store.state;
    if (!this.roomExists(id)) return { ok: false, code: "NOT_FOUND", message: "Kamer niet gevonden" };
    s.rooms = s.rooms.filter((r) => r.id !== id);
    for (const d of Object.values(s.devices)) if (d.roomId === id) d.roomId = null;
    await this.o.store.save();
    this.audit("room.delete", "user", id, null, true);
    this.scheduleEmit();
    return { ok: true };
  }

  // ---------- opdrachten ----------

  async executeCommand(id: string, command: DeviceCommand, source: CommandSource): Promise<OpResult<Device>> {
    const r = this.records.get(id);
    if (!r || !this.isAdded(id)) return this.fail("device.command", source, id, command, "NOT_FOUND", "Apparaat niet gevonden");
    const device = this.toDevice(r);
    const check = checkCommand(device, command, { source, emergencyStop: this.o.store.state.emergencyStop });
    if (!check.ok) return this.fail("device.command", source, id, command, check.code, check.reason);
    try {
      const res = await r.adapter.executeCommand(r.info.externalId, command);
      if (!res.ok) return this.fail("device.command", source, id, command, res.code, res.message);
      this.applyReport(r, res.report);
    } catch (err) {
      return this.fail("device.command", source, id, command, "ADAPTER_ERROR", `Uitvoeren mislukt: ${String(err)}`);
    }
    this.audit("device.command", source, id, command, true);
    this.scheduleEmit();
    return { ok: true, value: this.toDevice(r) };
  }

  async activateScene(sceneId: string, source: CommandSource): Promise<OpResult> {
    const scene = this.scenes.find((s) => s.id === sceneId);
    const adapter = scene && this.o.adapters.find((a) => a.id === scene.adapterId);
    if (!scene || !adapter?.activateScene) return this.fail("scene.activate", source, sceneId, null, "NOT_FOUND", "Scène niet gevonden");
    if (source !== "user" && this.o.store.state.emergencyStop) {
      return this.fail("scene.activate", source, sceneId, null, "EMERGENCY_STOP", "Noodstop actief: automatische opdrachten zijn gepauzeerd.");
    }
    const res = await adapter.activateScene(sceneId.slice(adapter.id.length + 1));
    if (!res.ok) return this.fail("scene.activate", source, sceneId, null, "ADAPTER_ERROR", res.message);
    this.audit("scene.activate", source, sceneId, null, true);
    this.scheduleEmit();
    return { ok: true };
  }

  async setEmergencyStop(active: boolean, source: CommandSource = "user"): Promise<void> {
    this.o.store.state.emergencyStop = active;
    await this.o.store.save();
    this.audit("emergency_stop", source, null, { active }, true);
    this.o.logger.warn(active ? "NOODSTOP geactiveerd" : "Noodstop opgeheven");
    this.scheduleEmit();
  }

  // ---------- energie ----------

  private energyAdapter(): DeviceAdapter | undefined {
    return this.o.adapters.find((a) => a.energy);
  }

  async energySummary(): Promise<EnergySummary | null> {
    return (await this.energyAdapter()?.energy?.getSummary()) ?? null;
  }

  async energyHistory(range: EnergyRange): Promise<EnergyHistory | null> {
    return (await this.energyAdapter()?.energy?.getHistory(range)) ?? null;
  }

  // ---------- intern ----------

  private audit(action: string, source: AuditEntry["source"], target: string | null, detail: unknown, ok: boolean, message?: string) {
    this.o.audit.append({ id: randomUUID(), at: this.now().toISOString(), action, source, target, detail, ok, ...(message ? { message } : {}) });
  }

  private fail(action: string, source: CommandSource, target: string, detail: unknown, code: CommandErrorCode, message: string) {
    this.audit(action, source, target, detail, false, message);
    return { ok: false as const, code, message };
  }

  private downHealth(a: DeviceAdapter, message: string): AdapterHealth {
    return { adapterId: a.id, integration: a.integration, displayName: a.displayName, demo: a.demo, status: "down", message, checkedAt: this.now().toISOString() };
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

import { randomUUID } from "node:crypto";
import type { Device, EnergySummary, Snapshot } from "@homeos/shared";
import type { Action, Automation, AutomationRun, Condition, NotificationCategory, RunStep, Trigger } from "./schema";

/**
 * HomeOS Automation Engine. Draait lokaal in de Device Connector.
 * Ontwerpregels:
 * - Geen inhaalacties: gemiste tijdstippen (connector uit) worden niet alsnog uitgevoerd; drempel-triggers vuren
 *   alleen op een overgang (onwaar → waar), nooit bij het opstarten.
 * - Geen dubbele uitvoering: één run tegelijk per automatisering, afkoeltijd, max. runs per dag, vaste sleutels per tijdstip.
 * - Noodstop: runs worden geblokkeerd en vastgelegd. Apparaatopdrachten gaan bovendien via de registry met bron
 *   "automation", die veiligheidskritische apparaten en de noodstop opnieuw afdwingt.
 */
export interface EngineDeps {
  now(): Date;
  snapshot(): Snapshot | null;
  energy(): Promise<EnergySummary | null>;
  executeCommand(deviceId: string, command: Extract<Action, { type: "device_command" }>["command"]): Promise<{ ok: true } | { ok: false; message: string }>;
  activateScene(sceneId: string): Promise<{ ok: true } | { ok: false; message: string }>;
  notify(n: { category: NotificationCategory; title: string; body: string }): void;
  emergencyStop(): boolean;
  sleep(ms: number): Promise<void>;
  onRun(run: AutomationRun): void;
}

export interface TriggerContext {
  device?: Device;
  offlineSince?: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const hhmmOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function readProperty(device: Device | undefined, property: string): number | boolean | null {
  if (!device || device.status !== "ONLINE") return null;
  const s = device.state;
  switch (property) {
    case "on":
      return typeof s.on === "boolean" ? s.on : null;
    case "powerW":
      return s.powerW ?? null;
    case "productionW":
      return s.productionW ?? null;
    case "brightness":
      return s.brightness ?? null;
    case "roomTempC":
      return s.climate?.roomTempC ?? null;
    default:
      return null;
  }
}

export function compare(actual: number | boolean | null, op: "eq" | "gt" | "lt", expected: number | boolean): boolean {
  if (actual === null) return false;
  if (op === "eq") return actual === expected;
  if (typeof actual !== "number" || typeof expected !== "number") return false;
  return op === "gt" ? actual > expected : actual < expected;
}

function inWindow(now: string, from: string, to: string): boolean {
  return from <= to ? now >= from && now < to : now >= from || now < to; // over middernacht
}

export class AutomationEngine {
  private automations: Automation[] = [];
  private running = new Set<string>();
  private lastRun = new Map<string, number>();
  private runsToday = new Map<string, { day: string; count: number }>();
  private firedTimes = new Set<string>();
  private edge = new Map<string, boolean>();
  private offlineFired = new Set<string>();
  private offlineSeen = new Map<string, number>();
  private stopped = false;

  constructor(private readonly d: EngineDeps) {}

  /** Cloudmodus: de toestand (laatste runs, drempelovergangen) bewaren tussen ticks. */
  exportState() {
    return {
      lastRun: [...this.lastRun],
      runsToday: [...this.runsToday],
      firedTimes: [...this.firedTimes].slice(-500),
      edge: [...this.edge],
      offlineFired: [...this.offlineFired],
      offlineSeen: [...this.offlineSeen],
    };
  }
  importState(s: unknown) {
    const v = (s ?? {}) as Partial<ReturnType<AutomationEngine["exportState"]>>;
    const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
    this.lastRun = new Map(arr<[string, number]>(v.lastRun));
    this.runsToday = new Map(arr<[string, { day: string; count: number }]>(v.runsToday));
    this.firedTimes = new Set(arr<string>(v.firedTimes));
    this.edge = new Map(arr<[string, boolean]>(v.edge));
    this.offlineFired = new Set(arr<string>(v.offlineFired));
    this.offlineSeen = new Map(arr<[string, number]>(v.offlineSeen));
  }

  setAutomations(list: Automation[]): void {
    this.automations = list;
    const ids = new Set(list.map((a) => a.id));
    for (const k of [...this.edge.keys()]) if (!ids.has(k.split("|")[0]!)) this.edge.delete(k);
  }

  stop(): void {
    this.stopped = true;
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /** Eén evaluatieronde (de connector roept dit elke ~20 s aan). */
  async tick(): Promise<void> {
    if (this.stopped) return;
    const now = this.d.now();
    const snap = this.d.snapshot();
    let energy: EnergySummary | null | undefined;
    const getEnergy = async () => (energy === undefined ? (energy = await this.d.energy().catch(() => null)) : energy);

    this.trackOffline(snap, now);
    for (const a of this.automations) {
      if (!a.enabled || a.trigger.type === "manual") continue;
      const fire = await this.evaluateTrigger(a, a.trigger, now, snap, getEnergy);
      if (fire) void this.run(a, fire === true ? {} : fire);
    }
    // oude sleutels opruimen
    if (this.firedTimes.size > 1000) this.firedTimes.clear();
  }

  private trackOffline(snap: Snapshot | null, now: Date) {
    if (!snap) return;
    for (const dev of snap.devices) {
      if (dev.status === "ONLINE") {
        this.offlineSeen.delete(dev.id);
        for (const k of [...this.offlineFired]) if (k.endsWith(`|${dev.id}`)) this.offlineFired.delete(k);
      } else if (!this.offlineSeen.has(dev.id)) {
        const since = dev.lastSeen ? Date.parse(dev.lastSeen) : now.getTime();
        this.offlineSeen.set(dev.id, Math.min(since, now.getTime()));
      }
    }
  }

  private async evaluateTrigger(a: Automation, t: Trigger, now: Date, snap: Snapshot | null, getEnergy: () => Promise<EnergySummary | null>): Promise<boolean | TriggerContext> {
    switch (t.type) {
      case "time": {
        if (t.days.length && !t.days.includes(now.getDay())) return false;
        if (hhmmOf(now) !== t.at) return false;
        const key = `${a.id}|${dateKey(now)}|${t.at}`;
        if (this.firedTimes.has(key)) return false;
        this.firedTimes.add(key);
        return true;
      }
      case "device_state":
      case "energy": {
        let value: boolean;
        let device: Device | undefined;
        if (t.type === "device_state") {
          device = snap?.devices.find((x) => x.id === t.deviceId);
          value = compare(readProperty(device, t.property), t.op, t.value);
        } else {
          const e = await getEnergy();
          const actual = e ? (e[t.metric === "productionW" ? "currentProductionW" : t.metric === "consumptionW" ? "currentConsumptionW" : t.metric] as number | null) : null;
          value = compare(actual, t.op, t.value);
        }
        const key = `${a.id}|edge`;
        const prev = this.edge.get(key);
        this.edge.set(key, value);
        // Eerste meting: alleen onthouden (geen actie bij opstarten). Daarna alleen op de overgang onwaar → waar.
        return prev === false && value ? { device } : false;
      }
      case "device_offline": {
        if (!snap) return false;
        const candidates = t.deviceId === "*" ? snap.devices : snap.devices.filter((x) => x.id === t.deviceId);
        for (const dev of candidates) {
          const since = this.offlineSeen.get(dev.id);
          if (since === undefined) continue;
          const key = `${a.id}|${dev.id}`;
          if (this.offlineFired.has(key)) continue;
          if (now.getTime() - since >= t.forMinutes * 60_000) {
            this.offlineFired.add(key);
            return { device: dev, offlineSince: dev.lastSeen };
          }
        }
        return false;
      }
      default:
        return false;
    }
  }

  private async conditionsHold(conditions: Condition[], now: Date): Promise<string | null> {
    const snap = this.d.snapshot();
    let energy: EnergySummary | null | undefined;
    for (const c of conditions) {
      let ok = true;
      if (c.type === "time_between") ok = inWindow(hhmmOf(now), c.from, c.to);
      else if (c.type === "weekday") ok = c.days.includes(now.getDay());
      else if (c.type === "device_online") ok = snap?.devices.find((x) => x.id === c.deviceId)?.status === "ONLINE";
      else if (c.type === "device_state") ok = compare(readProperty(snap?.devices.find((x) => x.id === c.deviceId), c.property), c.op, c.value);
      else if (c.type === "energy") {
        energy ??= await this.d.energy().catch(() => null);
        const actual = energy ? (energy[c.metric === "productionW" ? "currentProductionW" : c.metric === "consumptionW" ? "currentConsumptionW" : c.metric] as number | null) : null;
        ok = compare(actual, c.op, c.value);
      }
      if (!ok) return `Voorwaarde niet vervuld: ${c.type}`;
    }
    return null;
  }

  async run(a: Automation, ctx: TriggerContext = {}, manual = false): Promise<AutomationRun> {
    const now = this.d.now();
    const base: AutomationRun = { id: randomUUID(), automationId: a.id, automationName: a.name, trigger: manual ? "manual" : a.trigger.type, startedAt: now.toISOString(), finishedAt: null, status: "running", steps: [], error: null };
    const finish = (status: AutomationRun["status"], error: string | null = null): AutomationRun => {
      const run = { ...base, status, error, finishedAt: this.d.now().toISOString() };
      this.d.onRun(run);
      return run;
    };

    if (this.running.has(a.id)) return finish("skipped", "Draait al (dubbele uitvoering voorkomen)");
    const day = dateKey(now);
    const counter = this.runsToday.get(a.id);
    const count = counter?.day === day ? counter.count : 0;
    if (count >= a.maxRunsPerDay) return finish("skipped", `Maximum van ${a.maxRunsPerDay} runs per dag bereikt`);
    const last = this.lastRun.get(a.id);
    if (!manual && last !== undefined && now.getTime() - last < a.cooldownMinutes * 60_000) return finish("skipped", "Afkoeltijd nog niet verstreken");
    if (this.d.emergencyStop()) return finish("blocked", "Noodstop actief: automatiseringen zijn gepauzeerd");
    if (!manual) {
      const failed = await this.conditionsHold(a.conditions, now);
      if (failed) return finish("skipped", failed);
    }

    this.running.add(a.id);
    this.lastRun.set(a.id, now.getTime());
    this.runsToday.set(a.id, { day, count: count + 1 });
    const steps: RunStep[] = [];
    try {
      for (const action of a.actions) {
        if (this.stopped) {
          steps.push({ action: action.type, ok: false, message: "Engine gestopt" });
          break;
        }
        if (this.d.emergencyStop()) {
          steps.push({ action: action.type, ok: false, message: "Noodstop geactiveerd tijdens de run" });
          break;
        }
        steps.push(await this.execute(action, ctx));
      }
    } finally {
      this.running.delete(a.id);
    }
    base.steps = steps;
    const failed = steps.filter((s) => !s.ok);
    return finish(failed.length ? "failed" : "succeeded", failed.length ? failed.map((s) => s.message).join("; ") : null);
  }

  private async execute(action: Action, ctx: TriggerContext): Promise<RunStep> {
    try {
      switch (action.type) {
        case "scene": {
          const r = await this.d.activateScene(action.sceneId);
          return { action: action.type, ok: r.ok, message: r.ok ? "Scène geactiveerd" : r.message };
        }
        case "device_command": {
          const r = await this.d.executeCommand(action.deviceId, action.command);
          return { action: action.type, ok: r.ok, message: r.ok ? "Opdracht uitgevoerd" : r.message };
        }
        case "notify": {
          const fill = async (s: string) => this.fill(s, ctx);
          this.d.notify({ category: action.category, title: await fill(action.title), body: await fill(action.message) });
          return { action: action.type, ok: true, message: "Melding verstuurd" };
        }
        case "report": {
          const body = action.kind === "energy" ? await this.energyReport() : await this.eveningReport();
          this.d.notify({ category: action.kind === "energy" ? "energy" : "automation", title: action.kind === "energy" ? "Energieoverzicht" : "Avondoverzicht", body });
          return { action: action.type, ok: true, message: "Rapport verstuurd" };
        }
        case "delay":
          await this.d.sleep(action.minutes * 60_000);
          return { action: action.type, ok: true, message: `${action.minutes} min gewacht` };
      }
    } catch (err) {
      return { action: action.type, ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Vervangt {device}, {lastSeen}, {productionW}, {consumptionW} en {time} in meldingsteksten. */
  private async fill(text: string, ctx: TriggerContext): Promise<string> {
    if (!text.includes("{")) return text;
    const e = /\{(productionW|consumptionW)\}/.test(text) ? await this.d.energy().catch(() => null) : null;
    const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" }) : "onbekend");
    return text
      .replaceAll("{device}", ctx.device?.name ?? "")
      .replaceAll("{lastSeen}", fmt(ctx.offlineSince ?? ctx.device?.lastSeen))
      .replaceAll("{productionW}", e?.currentProductionW != null ? `${Math.round(e.currentProductionW)} W` : "onbekend")
      .replaceAll("{consumptionW}", e?.currentConsumptionW != null ? `${Math.round(e.currentConsumptionW)} W` : "onbekend")
      .replaceAll("{time}", hhmmOf(this.d.now()));
  }

  private async energyReport(): Promise<string> {
    const e = await this.d.energy().catch(() => null);
    if (!e) return "Er is geen energiebron gekoppeld.";
    const kwh = (n: number | null) => (n == null ? "onbekend" : `${n.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} kWh`);
    const parts = [`Opwek nu ${e.currentProductionW != null ? `${Math.round(e.currentProductionW)} W` : "onbekend"}`, `vandaag ${kwh(e.today.productionKwh)} opgewekt`];
    if (e.today.consumptionKwh != null) parts.push(`${kwh(e.today.consumptionKwh)} verbruikt`);
    return `${parts.join(", ")}${e.demo ? " (DEMO)" : ""}.`;
  }

  private async eveningReport(): Promise<string> {
    const snap = this.d.snapshot();
    const lights = snap?.devices.filter((x) => x.kind === "light" && x.status === "ONLINE" && x.state.on) ?? [];
    const offline = snap?.devices.filter((x) => x.status !== "ONLINE") ?? [];
    const parts = [lights.length ? `${lights.length} lamp(en) aan` : "alle lampen uit"];
    parts.push(offline.length ? `${offline.length} apparaat/apparaten niet bereikbaar (${offline.map((x) => x.name).slice(0, 3).join(", ")})` : "alle apparaten online");
    parts.push(await this.energyReport());
    return parts.join(" · ");
  }
}

/** Kant-en-klare sjablonen uit de specificatie. */
export function templates(opts: { sceneId?: string | null; deviceId?: string | null } = {}) {
  return {
    evening: {
      name: "Avondmodus",
      enabled: true,
      trigger: { type: "time" as const, at: "20:00", days: [] },
      conditions: [],
      actions: [
        ...(opts.sceneId ? [{ type: "scene" as const, sceneId: opts.sceneId }] : []),
        { type: "report" as const, kind: "evening" as const },
      ],
      cooldownMinutes: 5,
      maxRunsPerDay: 2,
    },
    energy: {
      name: "Energiemelding",
      enabled: true,
      trigger: { type: "energy" as const, metric: "productionW" as const, op: "gt" as const, value: 3000 },
      conditions: [],
      actions: [{ type: "notify" as const, category: "energy" as const, title: "Hoge zonne-opwek", message: "De panelen leveren nu {productionW}. Goed moment voor de wasmachine." }],
      cooldownMinutes: 120,
      maxRunsPerDay: 3,
    },
    offline: {
      name: "Apparaat offline",
      enabled: true,
      trigger: { type: "device_offline" as const, deviceId: opts.deviceId ?? "*", forMinutes: 30 },
      conditions: [],
      actions: [{ type: "notify" as const, category: "connection" as const, title: "{device} is offline", message: "{device} is al 30 minuten niet bereikbaar. Laatst gezien: {lastSeen}." }],
      cooldownMinutes: 0,
      maxRunsPerDay: 20,
    },
  };
}

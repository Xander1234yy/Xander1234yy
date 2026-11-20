import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
  AutomationEngine,
  AutomationInputSchema,
  AutomationSchema,
  NOTIFICATION_CATEGORIES,
  templates,
  type Automation,
  type AutomationInput,
  type AutomationRun,
  type HomeNotification,
  type NotificationCategory,
} from "@homeos/automation";
import { SAFETY_CRITICAL_KINDS, type DeviceEvent } from "@homeos/shared";
import type { Logger } from "@homeos/integrations";
import { readFileOrNull, writeFileAtomic } from "./fs-utils";
import { Journal } from "./journal";
import type { DeviceRegistry } from "./registry";
import { SetupError } from "./cloud-service";

const StoreSchema = z.object({
  version: z.literal(1),
  automations: z.array(AutomationSchema),
  preferences: z.partialRecord(z.enum(NOTIFICATION_CATEGORIES), z.boolean()).default({}),
});
type Store = z.infer<typeof StoreSchema>;

const TICK_MS = 20_000;

/**
 * Automatiseringen, uitvoeringsgeschiedenis en meldingen in de connector.
 * Alles lokaal: werkt ook zonder cloud, en stopt als de laptop uit staat (geen inhaalacties).
 */
export async function createAutomationService(o: { registry: DeviceRegistry; dataDir: string | null; logger: Logger; now?: () => Date; tickMs?: number }) {
  const file = o.dataDir ? path.join(o.dataDir, "automations.json") : null;
  let store: Store = { version: 1, automations: [], preferences: {} };
  const raw = file ? await readFileOrNull(file) : null;
  if (raw) {
    const p = StoreSchema.safeParse(JSON.parse(raw));
    if (p.success) store = p.data;
    else o.logger.warn("automations.json ongeldig; leeg begonnen");
  }
  const runs = await Journal.open<AutomationRun>(o.dataDir, "automation-runs", 500);
  const notifications = await Journal.open<HomeNotification>(o.dataDir, "notifications", 300);
  const emitter = new EventEmitter();
  const now = o.now ?? (() => new Date());
  const save = async () => {
    if (file) await writeFileAtomic(file, JSON.stringify(store, null, 2));
  };

  const enabledCategory = (c: NotificationCategory) => store.preferences[c] !== false;
  const notify = (n: { category: NotificationCategory; title: string; body: string }) => {
    if (!enabledCategory(n.category)) return;
    const note: HomeNotification = { id: randomUUID(), at: now().toISOString(), category: n.category, title: n.title.slice(0, 120), body: n.body.slice(0, 1000), read: false };
    notifications.append(note);
    emitter.emit("notification", note);
  };

  const engine = new AutomationEngine({
    now,
    snapshot: () => o.registry.snapshot(),
    energy: () => o.registry.energySummary(),
    executeCommand: async (deviceId, command) => {
      const r = await o.registry.executeCommand(deviceId, command, "automation");
      return r.ok ? { ok: true } : { ok: false, message: r.message };
    },
    activateScene: async (sceneId) => {
      const r = await o.registry.activateScene(sceneId, "automation");
      return r.ok ? { ok: true } : { ok: false, message: r.message };
    },
    notify,
    emergencyStop: () => o.registry.snapshot().connector.emergencyStop,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms).unref?.()),
    onRun: (run) => {
      runs.append(run);
      emitter.emit("run", run);
      if (run.status === "failed") notify({ category: "automation", title: `Automatisering "${run.automationName}" mislukt`, body: run.error ?? "" });
    },
  });
  engine.setAutomations(store.automations);

  // Deurbel en camerabeweging → beveiligingsmelding. Beweging maximaal eens per 5 minuten per camera.
  const lastMotionNotice = new Map<string, number>();
  o.registry.on("event", (e: DeviceEvent) => {
    if (e.type === "doorbell_ring") notify({ category: "security", title: "Er wordt aangebeld", body: `${e.message}${e.demo ? " (DEMO)" : ""}` });
    if (e.type === "motion") {
      const t = Date.parse(e.at) || Date.now();
      if (t - (lastMotionNotice.get(e.deviceId) ?? 0) < 5 * 60_000) return;
      lastMotionNotice.set(e.deviceId, t);
      notify({ category: "security", title: "Beweging gezien", body: `${e.message}${e.demo ? " (DEMO)" : ""}` });
    }
  });

  const timer = setInterval(() => void engine.tick().catch((err) => o.logger.error("Automatisering-tick mislukt", { error: String(err) })), o.tickMs ?? TICK_MS);
  timer.unref?.();

  const find = (id: string) => {
    const a = store.automations.find((x) => x.id === id);
    if (!a) throw new SetupError(404, "NOT_FOUND", "Automatisering niet gevonden");
    return a;
  };
  const validateRefs = (input: AutomationInput) => {
    const snap = o.registry.snapshot();
    const ids = new Set(snap.devices.map((d) => d.id));
    const scenes = new Set(snap.scenes.map((s) => s.id));
    for (const a of input.actions) {
      if (a.type === "device_command" && !ids.has(a.deviceId)) throw new SetupError(400, "INVALID", "Onbekend apparaat in een actie");
      if (a.type === "scene" && !scenes.has(a.sceneId)) throw new SetupError(400, "INVALID", "Onbekende scène in een actie");
      if (a.type === "device_command") {
        const d = snap.devices.find((x) => x.id === a.deviceId)!;
        if (SAFETY_CRITICAL_KINDS.has(d.kind)) throw new SetupError(400, "FORBIDDEN", `${d.name} mag niet door automatiseringen bediend worden`);
      }
    }
    const t = input.trigger;
    if ((t.type === "device_state" || t.type === "device_offline") && t.deviceId !== "*" && !ids.has(t.deviceId)) throw new SetupError(400, "INVALID", "Onbekend apparaat in de trigger");
  };

  return {
    events: emitter,
    stop: () => {
      clearInterval(timer);
      engine.stop();
    },
    tick: () => engine.tick(),
    list: () => store.automations.map((a) => ({ ...a, running: engine.isRunning(a.id) })),
    runs: (limit = 50, automationId?: string) => runs.latest(500).filter((r) => !automationId || r.automationId === automationId).slice(0, limit),
    templates: () => {
      const snap = o.registry.snapshot();
      const scene = snap.scenes.find((s) => /avond|ontspan|relax/i.test(s.name)) ?? snap.scenes[0];
      return templates({ sceneId: scene?.id ?? null });
    },
    async create(input: unknown) {
      const p = AutomationInputSchema.safeParse(input);
      if (!p.success) throw new SetupError(400, "INVALID", p.error.issues[0]?.message ?? "Ongeldige automatisering");
      validateRefs(p.data);
      const ts = now().toISOString();
      const a: Automation = { ...p.data, id: randomUUID(), createdAt: ts, updatedAt: ts };
      store.automations.push(a);
      await save();
      engine.setAutomations(store.automations);
      return a;
    },
    async update(id: string, input: unknown) {
      const current = find(id);
      const merged = { ...current, ...(input as object) };
      const p = AutomationInputSchema.safeParse(merged);
      if (!p.success) throw new SetupError(400, "INVALID", p.error.issues[0]?.message ?? "Ongeldige automatisering");
      validateRefs(p.data);
      Object.assign(current, p.data, { updatedAt: now().toISOString() });
      await save();
      engine.setAutomations(store.automations);
      return current;
    },
    async remove(id: string) {
      find(id);
      store.automations = store.automations.filter((a) => a.id !== id);
      await save();
      engine.setAutomations(store.automations);
      return { ok: true };
    },
    async runNow(id: string) {
      return engine.run(find(id), {}, true);
    },
    notifications: (limit = 50) => notifications.latest(limit),
    markRead(ids: string[] | "all") {
      // Journal is append-only; we markeren in het geheugen (meldingen zijn kortlevend).
      for (const n of notifications.latest(300)) if (ids === "all" || ids.includes(n.id)) n.read = true;
      return { ok: true };
    },
    preferences: () => Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, enabledCategory(c)])) as Record<NotificationCategory, boolean>,
    async setPreferences(prefs: Partial<Record<NotificationCategory, boolean>>) {
      store.preferences = { ...store.preferences, ...prefs };
      await save();
      return Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, enabledCategory(c)]));
    },
    notify,
  };
}

export type AutomationService = Awaited<ReturnType<typeof createAutomationService>>;

import { describe, expect, it } from "vitest";
import type { Device, EnergySummary, Snapshot } from "@homeos/shared";
import { AutomationEngine, AutomationInputSchema, templates, type Automation, type AutomationRun, type EngineDeps } from "../src";

const iso = new Date().toISOString();
const device = (o: Partial<Device>): Device => ({
  id: "lamp", name: "Lamp", brand: "", model: "", kind: "light", roomId: null, integration: "demo", adapterId: "x", status: "ONLINE",
  lastSeen: iso, stateUpdatedAt: iso, capabilities: ["onoff"], state: { on: false }, error: null, demo: true, ...o,
});

function setup(initial: Device[] = [device({})]) {
  let now = new Date(2026, 10, 20, 19, 59, 30);
  let devices = initial;
  let production = 500;
  let stop = false;
  const runs: AutomationRun[] = [];
  const notes: { title: string; body: string; category: string }[] = [];
  const commands: string[] = [];
  const scenes: string[] = [];
  const deps: EngineDeps = {
    now: () => now,
    snapshot: () => ({ devices, rooms: [], scenes: [], generatedAt: iso, connector: { connectorId: "c", version: "1", startedAt: iso, demoMode: true, emergencyStop: stop, adapters: [] } }) as Snapshot,
    energy: async () => ({ sourceId: "x", demo: false, updatedAt: iso, currentProductionW: production, currentConsumptionW: null, gridImportW: null, gridExportW: null, today: { productionKwh: 4.2, consumptionKwh: null, importKwh: null, exportKwh: null }, month: { productionKwh: 1, consumptionKwh: null, importKwh: null, exportKwh: null }, year: { productionKwh: 1, consumptionKwh: null, importKwh: null, exportKwh: null } }) as EnergySummary,
    executeCommand: async (id, c) => (commands.push(`${id}:${JSON.stringify(c)}`), { ok: true }),
    activateScene: async (id) => (scenes.push(id), { ok: true }),
    notify: (n) => notes.push(n),
    emergencyStop: () => stop,
    sleep: async () => undefined,
    onRun: (r) => runs.push(r),
  };
  const engine = new AutomationEngine(deps);
  const add = (input: unknown): Automation => {
    const a = { ...AutomationInputSchema.parse(input), id: crypto.randomUUID(), createdAt: iso, updatedAt: iso };
    engine.setAutomations([a]);
    return a;
  };
  const settle = () => new Promise((r) => setTimeout(r, 5));
  return {
    engine, runs, notes, commands, scenes, add, settle,
    at: (h: number, m: number, s = 0) => (now = new Date(2026, 10, 20, h, m, s)),
    setDevices: (d: Device[]) => (devices = d),
    setProduction: (p: number) => (production = p),
    setStop: (v: boolean) => (stop = v),
  };
}

describe("validatie", () => {
  it("weigert ongeldige automatiseringen", () => {
    expect(AutomationInputSchema.safeParse({ name: "x", trigger: { type: "time", at: "25:00" }, actions: [{ type: "report", kind: "evening" }] }).success).toBe(false);
    expect(AutomationInputSchema.safeParse({ name: "x", trigger: { type: "manual" }, actions: [] }).success).toBe(false);
    expect(AutomationInputSchema.safeParse({ name: "x", trigger: { type: "manual" }, actions: [{ type: "delay", minutes: 600 }] }).success).toBe(false);
    for (const t of Object.values(templates({ sceneId: "demo-lights:avond" }))) expect(AutomationInputSchema.safeParse(t).success).toBe(true);
  });
});

describe("tijd-trigger (Avondmodus)", () => {
  it("vuurt precies één keer op het ingestelde tijdstip", async () => {
    const t = setup();
    t.add(templates({ sceneId: "demo-lights:avond" }).evening);
    await t.engine.tick();
    expect(t.runs).toEqual([]);
    t.at(20, 0, 5);
    await t.engine.tick();
    t.at(20, 0, 40);
    await t.engine.tick();
    await t.settle();
    expect(t.runs.map((r) => r.status)).toEqual(["succeeded"]);
    expect(t.scenes).toEqual(["demo-lights:avond"]);
    expect(t.notes[0]).toMatchObject({ title: "Avondoverzicht" });
    expect(t.notes[0]!.body).toContain("4,2 kWh");
  });

  it("haalt een gemist tijdstip niet in (connector stond uit)", async () => {
    const t = setup();
    t.add(templates().evening);
    t.at(20, 5);
    await t.engine.tick();
    await t.settle();
    expect(t.runs).toEqual([]);
  });

  it("respecteert dagen van de week", async () => {
    const t = setup();
    t.add({ ...templates().evening, trigger: { type: "time", at: "20:00", days: [0] } }); // alleen zondag; 20 nov 2026 is vrijdag
    t.at(20, 0);
    await t.engine.tick();
    await t.settle();
    expect(t.runs).toEqual([]);
  });
});

describe("drempel-trigger (Energiemelding)", () => {
  it("vuurt alleen op de overgang, niet bij opstarten, en respecteert de afkoeltijd", async () => {
    const t = setup();
    t.setProduction(3500);
    t.add(templates().energy);
    await t.engine.tick(); // al boven de drempel bij start → geen actie
    await t.settle();
    expect(t.runs).toEqual([]);
    t.setProduction(1000);
    await t.engine.tick();
    t.setProduction(3200);
    await t.engine.tick();
    await t.settle();
    expect(t.notes.at(-1)).toMatchObject({ category: "energy", title: "Hoge zonne-opwek", body: expect.stringContaining("3200 W") });
    t.setProduction(1000);
    await t.engine.tick();
    t.setProduction(3300);
    await t.engine.tick(); // binnen afkoeltijd van 120 min
    await t.settle();
    expect(t.runs.map((r) => r.status)).toEqual(["succeeded", "skipped"]);
  });
});

describe("offline-trigger", () => {
  it("meldt een apparaat dat langer dan de ingestelde tijd offline is, één keer per episode", async () => {
    const t = setup();
    t.add(templates().offline);
    t.at(10, 0);
    t.setDevices([device({ status: "OFFLINE", lastSeen: new Date(2026, 10, 20, 9, 50).toISOString() })]);
    await t.engine.tick();
    await t.settle();
    expect(t.runs).toEqual([]);
    t.at(10, 21);
    await t.engine.tick();
    await t.engine.tick();
    await t.settle();
    expect(t.notes).toHaveLength(1);
    expect(t.notes[0]!.title).toBe("Lamp is offline");
    expect(t.notes[0]!.body).toMatch(/Laatst gezien: \d/);
    t.setDevices([device({})]);
    await t.engine.tick();
    t.setDevices([device({ status: "OFFLINE", lastSeen: new Date(2026, 10, 20, 10, 21).toISOString() })]);
    t.at(11, 0);
    await t.engine.tick();
    await t.settle();
    expect(t.notes).toHaveLength(2);
  });
});

describe("veiligheid", () => {
  it("blokkeert runs tijdens de noodstop", async () => {
    const t = setup();
    const a = t.add({ name: "Test", trigger: { type: "manual" }, actions: [{ type: "device_command", deviceId: "lamp", command: { type: "set_power", on: true } }] });
    t.setStop(true);
    const r = await t.engine.run(a, {}, true);
    expect(r.status).toBe("blocked");
    expect(t.commands).toEqual([]);
  });

  it("voorkomt gelijktijdige dubbele runs en begrenst runs per dag", async () => {
    const t = setup();
    const a = t.add({ name: "Test", trigger: { type: "manual" }, actions: [{ type: "notify", title: "x" }], maxRunsPerDay: 2 });
    const [r1, r2] = await Promise.all([t.engine.run(a, {}, true), t.engine.run(a, {}, true)]);
    expect([r1.status, r2.status].sort()).toEqual(["skipped", "succeeded"]);
    await t.engine.run(a, {}, true);
    expect((await t.engine.run(a, {}, true)).error).toMatch(/Maximum/);
  });

  it("controleert voorwaarden en legt mislukte stappen vast zonder te stoppen", async () => {
    const t = setup();
    const a = t.add({ name: "Test", trigger: { type: "time", at: "20:00" }, conditions: [{ type: "device_online", deviceId: "lamp" }], actions: [{ type: "scene", sceneId: "s" }, { type: "notify", title: "na de scène" }] });
    t.setDevices([device({ status: "OFFLINE" })]);
    t.at(20, 0);
    await t.engine.tick();
    await t.settle();
    expect(t.runs[0]).toMatchObject({ status: "skipped", error: expect.stringMatching(/Voorwaarde/) });
    const failing = new AutomationEngine({ ...({} as EngineDeps), now: () => new Date(), snapshot: () => null, energy: async () => null, emergencyStop: () => false, sleep: async () => undefined, onRun: () => undefined, notify: () => undefined, executeCommand: async () => ({ ok: false, message: "mag niet" }), activateScene: async () => ({ ok: false, message: "scène kapot" }) });
    const r = await failing.run(a, {}, true);
    expect(r.status).toBe("failed");
    expect(r.steps.map((s) => s.ok)).toEqual([false, true]);
  });
});

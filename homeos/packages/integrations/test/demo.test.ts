import { describe, expect, it } from "vitest";
import { DemoEnergyModel, DemoLightsAdapter, DemoDoorbellAdapter, type AdapterContext, type AdapterEvent } from "../src";

function ctx(events: AdapterEvent[] = []): AdapterContext {
  const store = new Map<string, string>();
  return {
    logger: { info() {}, warn() {}, error() {} },
    now: () => new Date(),
    emit: (e) => events.push(e),
    secrets: { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k) },
  };
}

describe("DemoLightsAdapter", () => {
  it("implementeert de adapterinterface en markeert alles als demo", async () => {
    const a = new DemoLightsAdapter();
    await a.connect(ctx());
    const devices = await a.discover();
    expect(devices.length).toBeGreaterThan(3);
    expect(a.demo).toBe(true);
    expect((await a.healthCheck()).demo).toBe(true);
    expect(a.getCapabilities("woonkamer-plafond")).toContain("color");
    await a.disconnect();
  });

  it("voert ondersteunde opdrachten uit", async () => {
    const a = new DemoLightsAdapter();
    await a.connect(ctx());
    const r = await a.executeCommand("keuken-spots", { type: "set_brightness", brightness: 42 });
    expect(r.ok && r.report.state).toMatchObject({ on: true, brightness: 42 });
    await a.disconnect();
  });

  it("weigert niet-ondersteunde opdrachten en offline apparaten", async () => {
    const a = new DemoLightsAdapter();
    await a.connect(ctx());
    const unsupported = await a.executeCommand("keuken-spots", { type: "set_color", colorHex: "#00ff00" });
    expect(unsupported.ok).toBe(false);
    const offline = await a.executeCommand("tuin-wandlamp", { type: "set_power", on: true });
    expect(!offline.ok && offline.code).toBe("DEVICE_UNAVAILABLE");
    expect((await a.getStatus("tuin-wandlamp")).status).toBe("OFFLINE");
    await a.disconnect();
  });

  it("activeert scènes en meldt statuswijzigingen", async () => {
    const events: AdapterEvent[] = [];
    const a = new DemoLightsAdapter();
    await a.connect(ctx(events));
    expect((await a.activateScene("nacht")).ok).toBe(true);
    expect((await a.getStatus("slaapkamer-nachtlamp")).state.on).toBe(true);
    expect((await a.getStatus("woonkamer-plafond")).state.on).toBe(false);
    expect(events.some((e) => e.type === "device_state")).toBe(true);
    expect((await a.activateScene("bestaat-niet")).ok).toBe(false);
    await a.disconnect();
  });
});

describe("DemoDoorbellAdapter", () => {
  it("weigert alle opdrachten en meldt gebeurtenissen", async () => {
    const events: AdapterEvent[] = [];
    const a = new DemoDoorbellAdapter();
    await a.connect(ctx(events));
    expect((await a.executeCommand("voordeur", { type: "set_power", on: true })).ok).toBe(false);
    a.simulate("doorbell_ring");
    expect(events.find((e) => e.type === "device_event")).toBeTruthy();
    await a.disconnect();
  });
});

describe("DemoEnergyModel", () => {
  const m = new DemoEnergyModel();
  const now = new Date(2026, 5, 15, 14, 30);

  it("is deterministisch", () => {
    expect(m.summary(now, "x")).toEqual(new DemoEnergyModel().summary(now, "x"));
  });

  it("heeft consistente totalen", () => {
    const s = m.summary(now, "x");
    expect(s.demo).toBe(true);
    expect(s.today.productionKwh!).toBeLessThanOrEqual(s.month.productionKwh!);
    expect(s.month.productionKwh!).toBeLessThanOrEqual(s.year.productionKwh!);
    // energiebalans: afname - teruglevering = verbruik - opwek
    const t = s.today;
    expect(t.importKwh! - t.exportKwh!).toBeCloseTo(t.consumptionKwh! - t.productionKwh!, 2);
  });

  it("produceert 's nachts niets", () => {
    expect(m.summary(new Date(2026, 5, 15, 2, 0), "x").currentProductionW).toBe(0);
  });

  it("levert historie per bereik", () => {
    expect(m.history(now, "day", "x").points.length).toBe(58);
    expect(m.history(now, "week", "x").points.length).toBe(7);
    expect(m.history(now, "month", "x").points.length).toBe(30);
    expect(m.history(now, "year", "x").points.length).toBe(6);
  });
});

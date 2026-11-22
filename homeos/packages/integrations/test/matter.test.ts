import { describe, expect, it } from "vitest";
import { MatterAdapter, normalizePairingCode } from "../src/matter/adapter";
import type { AdapterContext } from "../src";
import { fakeMatter } from "./fake-matter";

const ctx: AdapterContext = {
  logger: { info() {}, warn() {}, error() {} },
  now: () => new Date(),
  emit: () => undefined,
  secrets: { get: async () => null, set: async () => undefined, delete: async () => undefined },
};

describe("Matter", () => {
  it("normaliseert koppelcodes en weigert onzin", () => {
    expect(normalizePairingCode("3497-011-2332")).toBe("34970112332");
    expect(normalizePairingCode(" 1234 5678 901 ")).toBe("12345678901");
    expect(normalizePairingCode("MT:Y.K9042C00KA0648G00")).toBe("MT:Y.K9042C00KA0648G00");
    expect(normalizePairingCode("123")).toBeNull();
    expect(normalizePairingCode("abc-def")).toBeNull();
  });

  it("koppelt een stekker, toont vermogen en schakelt", async () => {
    const f = fakeMatter();
    const a = new MatterAdapter(f.backend);
    await a.connect(ctx);
    await expect(a.commission("geen code")).rejects.toThrow(/koppelcode/);
    const nodeId = await a.commission("3497-011-2332");
    const [d] = await a.discover();
    expect(d).toMatchObject({ externalId: `${nodeId}-1`, brand: "IKEA of Sweden", model: "GRILLPLATS (SIM)", kind: "plug", capabilities: ["onoff", "power_metering"] });
    expect((await a.getStatus(d!.externalId)).state).toEqual({ on: false, powerW: 12.3 });
    const r = await a.executeCommand(d!.externalId, { type: "set_power", on: true });
    expect(r.ok && r.report.state.on).toBe(true);
    expect(f.calls).toContain(`onoff:${nodeId}/1=true`);
    expect((await a.executeCommand(d!.externalId, { type: "set_color", colorHex: "#ff0000" })).ok).toBe(false);
  });

  it("meldt offline apparaten en een mislukte koppeling eerlijk", async () => {
    const f = fakeMatter();
    const a = new MatterAdapter(f.backend);
    await a.connect(ctx);
    await a.commission("34970112332");
    f.nodes[0]!.online = false;
    const id = `${f.nodes[0]!.nodeId}-1`;
    expect((await a.getStatus(id)).status).toBe("OFFLINE");
    expect((await a.executeCommand(id, { type: "set_power", on: true })).ok).toBe(false);
    const bad = new MatterAdapter(fakeMatter({ failCommission: true }).backend);
    await bad.connect(ctx);
    await expect(bad.commission("34970112332")).rejects.toThrow(/time-out/);
  });

  it("meldt een Matter-stack die niet kan starten (bijv. geen IPv6)", async () => {
    const a = new MatterAdapter({ ...fakeMatter().backend, start: async () => Promise.reject(new Error("Cannot bind to {::}:5353")) });
    await a.connect(ctx);
    const h = await a.healthCheck();
    expect(h.status).toBe("down");
    expect(h.message).toMatch(/5353/);
    await expect(a.commission("34970112332")).rejects.toThrow(/kon niet starten/);
  });
});

import { describe, expect, it } from "vitest";
import {
  calculateCost,
  checkCommand,
  CommandRequestSchema,
  DeviceCommandSchema,
  effectiveStatus,
  stateFreshness,
  supportsCommand,
} from "../src";

const light = { name: "Lamp", kind: "light" as const, status: "ONLINE" as const, capabilities: ["onoff", "brightness"] as ("onoff" | "brightness")[] };

describe("command validatie", () => {
  it("accepteert geldige opdrachten en weigert ongeldige", () => {
    expect(DeviceCommandSchema.safeParse({ type: "set_brightness", brightness: 50 }).success).toBe(true);
    expect(DeviceCommandSchema.safeParse({ type: "set_brightness", brightness: 500 }).success).toBe(false);
    expect(DeviceCommandSchema.safeParse({ type: "set_color", colorHex: "red" }).success).toBe(false);
    expect(DeviceCommandSchema.safeParse({ type: "rm -rf", on: true }).success).toBe(false);
  });

  it("zet standaardbron op user", () => {
    const r = CommandRequestSchema.parse({ command: { type: "set_power", on: true } });
    expect(r.source).toBe("user");
  });
});

describe("checkCommand", () => {
  const opts = { source: "user" as const, emergencyStop: false };

  it("staat ondersteunde opdrachten toe", () => {
    expect(checkCommand(light, { type: "set_power", on: true }, opts)).toEqual({ ok: true });
  });

  it("weigert opdrachten zonder capability", () => {
    const r = checkCommand(light, { type: "set_color", colorHex: "#ff0000" }, opts);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("UNSUPPORTED");
  });

  it("weigert opdrachten aan offline apparaten", () => {
    const r = checkCommand({ ...light, status: "OFFLINE" }, { type: "set_power", on: true }, opts);
    expect(!r.ok && r.code).toBe("DEVICE_UNAVAILABLE");
  });

  it("blokkeert automatische opdrachten bij noodstop, maar niet handmatige", () => {
    const cmd = { type: "set_power", on: false } as const;
    expect(checkCommand(light, cmd, { source: "automation", emergencyStop: true }).ok).toBe(false);
    expect(checkCommand(light, cmd, { source: "jarvis", emergencyStop: true }).ok).toBe(false);
    expect(checkCommand(light, cmd, { source: "user", emergencyStop: true }).ok).toBe(true);
  });

  it("laat Jarvis en automatiseringen geen veiligheidskritische apparaten bedienen", () => {
    const bell = { name: "Deurbel", kind: "doorbell" as const, status: "ONLINE" as const, capabilities: ["onoff" as const] };
    const r = checkCommand(bell, { type: "set_power", on: true }, { source: "jarvis", emergencyStop: false });
    expect(!r.ok && r.code).toBe("FORBIDDEN");
  });

  it("supportsCommand volgt capabilities", () => {
    expect(supportsCommand(light, "set_brightness")).toBe(true);
    expect(supportsCommand(light, "media")).toBe(false);
  });
});

describe("versheid van gegevens", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  const d = { status: "ONLINE" as const, stateUpdatedAt: "2026-01-01T11:59:30Z" };

  it("is live bij recente uitlezing en online connector", () => {
    expect(stateFreshness(d, { connectorOnline: true, now })).toBe("live");
  });
  it("is nooit live als de connector offline is", () => {
    expect(stateFreshness(d, { connectorOnline: false, now })).toBe("stale");
    expect(effectiveStatus(d, false)).toBe("UNKNOWN");
  });
  it("is verouderd na de drempel", () => {
    expect(stateFreshness({ ...d, stateUpdatedAt: "2026-01-01T11:50:00Z" }, { connectorOnline: true, now })).toBe("stale");
  });
  it("is onbekend zonder uitlezing", () => {
    expect(stateFreshness({ status: "ONLINE", stateUpdatedAt: null }, { connectorOnline: true, now })).toBe("unknown");
  });
});

describe("kostenberekening", () => {
  it("rekent afname, teruglevering en eigen verbruik uit", () => {
    const c = calculateCost({ productionKwh: 10, consumptionKwh: 12, importKwh: 6, exportKwh: 4 }, { importPerKwh: 0.3, exportPerKwh: 0.1 });
    expect(c).toEqual({ importCost: 1.8, exportCredit: 0.4, net: 1.4, selfConsumptionKwh: 6, selfConsumptionSaving: 1.8 });
  });
  it("geeft null zonder gegevens (nooit gokken)", () => {
    expect(calculateCost({ productionKwh: null, consumptionKwh: null, importKwh: null, exportKwh: 1 })).toBeNull();
  });
});

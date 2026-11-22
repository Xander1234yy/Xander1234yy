import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { EnergyHistory } from "@homeos/shared";
import { createAutomationService, weeklyEnergyText } from "../src/automation-service";
import { memoryStorage, registerStorage, unregisterStorage } from "../src/fs-utils";
import { silent } from "./helpers";

const week: EnergyHistory = {
  sourceId: "solaredge-1",
  demo: false,
  range: "week",
  bucket: "day",
  points: [
    { t: "2026-11-16T00:00:00+01:00", productionKwh: 3.2, consumptionKwh: 9.5, importKwh: null, exportKwh: null },
    { t: "2026-11-21T00:00:00+01:00", productionKwh: 6.8, consumptionKwh: 8.1, importKwh: null, exportKwh: null },
    { t: "2026-11-22T00:00:00+01:00", productionKwh: 1.0, consumptionKwh: 7.4, importKwh: null, exportKwh: null },
  ],
};

describe("wekelijks energieverslag", () => {
  it("tekst met opwek, beste dag en verbruik; niets zonder energiebron", () => {
    expect(weeklyEnergyText(week)).toBe("Opwek 11 kWh (beste dag zaterdag: 6,8 kWh) · verbruik 25 kWh.");
    expect(weeklyEnergyText(null)).toBeNull();
    expect(weeklyEnergyText({ ...week, points: [] })).toBeNull();
  });

  it("stuurt zondag vanaf 18:00 precies één melding per week, ook over aanvragen heen (cloudmodus)", async () => {
    const prefix = "db://88888888-2222-4333-8444-555555555555";
    registerStorage(prefix, memoryStorage());
    try {
      const reg = Object.assign(new EventEmitter(), {
        snapshot: () => ({ devices: [], scenes: [], rooms: [], connector: {} }),
        energySummary: async () => null,
        energyHistory: async () => week,
        executeCommand: async () => ({ ok: true }),
      });
      let clock = new Date("2026-11-22T16:30:00Z"); // zondag 17:30 in Amsterdam
      const make = () => createAutomationService({ registry: reg as never, dataDir: prefix, logger: silent, now: () => clock, serverless: true });
      const notes: { title: string; body: string }[] = [];
      let a = await make();
      a.events.on("notification", (n) => notes.push(n));
      await a.tick();
      expect(notes).toHaveLength(0); // nog geen 18:00
      clock = new Date("2026-11-22T17:05:00Z"); // 18:05
      await a.tick();
      await a.tick();
      expect(notes.map((n) => n.title)).toEqual(["Weekoverzicht energie"]);
      // Nieuwe aanvraag (serverless) dezelfde avond: niet nog eens.
      a = await make();
      a.events.on("notification", (n) => notes.push(n));
      clock = new Date("2026-11-22T19:00:00Z");
      await a.tick();
      expect(notes).toHaveLength(1);
      // Maandag: niets; volgende zondag weer wel.
      clock = new Date("2026-11-23T18:00:00Z");
      await a.tick();
      clock = new Date("2026-11-29T17:30:00Z");
      await a.tick();
      expect(notes).toHaveLength(2);
    } finally {
      unregisterStorage(prefix);
    }
  });
});

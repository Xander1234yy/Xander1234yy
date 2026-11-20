import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EnergyHistory, EnergySummary } from "@homeos/shared";
import { mergeGrid, mergeGridHistory } from "../src/registry";
import { startTestConnector } from "./helpers";
import { fakeZonneplan } from "../../../packages/integrations/test/fake-zonneplan";

type T = Awaited<ReturnType<typeof startTestConnector>>;
let t: T | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

const p = (prod: number | null, cons: number | null, imp: number | null, exp: number | null) => ({ productionKwh: prod, consumptionKwh: cons, importKwh: imp, exportKwh: exp });

describe("energie: opwek + meter", () => {
  const solar: EnergySummary = { sourceId: "solaredge", demo: false, updatedAt: "2026-11-21T10:05:00.000Z", currentProductionW: 2000, currentConsumptionW: null, gridImportW: null, gridExportW: null, today: p(6, null, null, null), month: p(80, null, null, null), year: p(2500, null, null, null) };
  const meter: EnergySummary = { sourceId: "zonneplan", demo: false, updatedAt: "2026-11-21T10:00:00.000Z", currentProductionW: null, currentConsumptionW: null, gridImportW: 300, gridExportW: 1200, today: p(null, null, 4, 3), month: p(null, null, 120, 40), year: p(null, null, 934.741, 220.582) };

  it("eigen verbruik = opwek + afname − teruglevering", () => {
    const m = mergeGrid(solar, meter);
    expect(m.currentConsumptionW).toBe(1100);
    expect(m.today).toEqual(p(6, 7, 4, 3));
    expect(m.year.consumptionKwh).toBe(3214.159);
    expect(m.updatedAt).toBe("2026-11-21T10:00:00.000Z");
  });

  it("zonder opwekbron: geen verbruik gokken", () => {
    const m = mergeGrid(null, meter);
    expect(m.currentConsumptionW).toBeNull();
    expect(m.today.consumptionKwh).toBeNull();
    expect(m.gridImportW).toBe(300);
  });

  it("historie: opwek per kwartier wordt opgeteld per meter-uur", () => {
    const base: EnergyHistory = { sourceId: "s", demo: false, range: "day", bucket: "15m", points: ["09:00", "09:15", "09:30", "09:45", "10:00"].map((h, i) => ({ t: `2026-11-21T${h}:00.000Z`, ...p(0.1 * (i + 1), null, null, null) })) };
    const grid: EnergyHistory = { sourceId: "z", demo: false, range: "day", bucket: "hour", points: [
      { t: "2026-11-21T09:00:00.000Z", ...p(null, null, 0.3, 0.1) },
      { t: "2026-11-21T10:00:00.000Z", ...p(null, null, 0.2, 0.4) },
    ] };
    const m = mergeGridHistory(base, grid);
    expect(m.points[0]).toEqual({ t: "2026-11-21T09:00:00.000Z", ...p(1, 1.2, 0.3, 0.1) });
    expect(m.points[1]).toEqual({ t: "2026-11-21T10:00:00.000Z", ...p(0.5, 0.3, 0.2, 0.4) });
  });
});

describe("Zonneplan in de connector", () => {
  it("code aanvragen, inloggen, meter toevoegen; e-mail en tokens niet leesbaar opgeslagen", async () => {
    const z = fakeZonneplan();
    t = await startTestConnector({ demo: false }, undefined, z.fetchImpl);
    const post = (p2: string, body: unknown) => t!.call(`/v1/integrations/zonneplan/${p2}`, { method: "POST", body: JSON.stringify(body) });
    expect((await post("complete", { code: "123456" })).status).toBe(409); // eerst een code aanvragen
    expect((await post("start", { email: "geen-mail" })).status).toBe(400);
    expect((await post("start", { email: "ik@example.test" })).status).toBe(200);
    expect((await post("complete", { code: "000000" })).status).toBe(400);
    expect((await post("start", { email: "ik@example.test" })).status).toBe(200);
    const done = await post("complete", { code: "123456" });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ ok: true, label: "Connect energiemeter" });

    const list = await (await t.call("/v1/integrations")).json();
    expect(list.zonneplan).toMatchObject({ connected: true, unofficial: true });
    const snap = await (await t.call("/v1/snapshot")).json();
    expect(snap.devices.find((d: { integration: string }) => d.integration === "zonneplan")).toMatchObject({ kind: "energy_meter", status: "ONLINE" });
    const energy = await (await t.call("/v1/energy/summary")).json();
    expect(energy).toMatchObject({ gridImportW: 711, gridExportW: 0 });

    const files = await Promise.all(["secrets.enc", "integrations.json", "registry.json"].map((f) => readFile(path.join(t!.dataDir, f), "utf8").catch(() => "")));
    expect(files.join("")).not.toContain("ik@example.test");
    expect(files.join("")).not.toContain("access-1");
    expect(files.join("")).not.toContain("refresh-1");

    expect((await t.call("/v1/integrations/zonneplan", { method: "DELETE" })).status).toBe(200);
    expect((await (await t.call("/v1/integrations")).json()).zonneplan.connected).toBe(false);
  }, 20_000);
});

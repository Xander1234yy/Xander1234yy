import { afterEach, describe, expect, it } from "vitest";
import { startTestConnector } from "./helpers";

type T = Awaited<ReturnType<typeof startTestConnector>>;
let t: T | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

const json = (r: Response) => r.json();

describe("automatiseringen in de connector", () => {
  it("levert sjablonen met een bestaande scène en maakt een automatisering aan", async () => {
    t = await startTestConnector();
    const tpl = await json(await t.call("/v1/automations/templates"));
    expect(tpl.evening.actions[0]).toEqual({ type: "scene", sceneId: "demo-lights:avond" });
    const created = await json(await t.call("/v1/automations", { method: "POST", body: JSON.stringify(tpl.evening) }));
    expect(created).toMatchObject({ name: "Avondmodus", enabled: true, id: expect.any(String) });
    const list = await json(await t.call("/v1/automations"));
    expect(list.automations).toHaveLength(1);
  });

  it("weigert onbekende apparaten en veiligheidskritische apparaten", async () => {
    t = await startTestConnector();
    const bad = await t.call("/v1/automations", { method: "POST", body: JSON.stringify({ name: "x", trigger: { type: "manual" }, actions: [{ type: "device_command", deviceId: "bestaat-niet", command: { type: "set_power", on: true } }] }) });
    expect(bad.status).toBe(400);
    const bell = await t.call("/v1/automations", { method: "POST", body: JSON.stringify({ name: "x", trigger: { type: "manual" }, actions: [{ type: "device_command", deviceId: "demo-doorbell:voordeur", command: { type: "set_power", on: true } }] }) });
    expect((await json(bell)).error.code).toBe("FORBIDDEN");
  });

  it("voert handmatig uit, legt de run vast en maakt een melding", async () => {
    t = await startTestConnector();
    const a = await json(
      await t.call("/v1/automations", {
        method: "POST",
        body: JSON.stringify({ name: "Spots aan", trigger: { type: "manual" }, actions: [{ type: "device_command", deviceId: "demo-lights:keuken-spots", command: { type: "set_power", on: true } }, { type: "notify", title: "Spots staan aan om {time}" }] }),
      }),
    );
    const run = await json(await t.call(`/v1/automations/${a.id}/run`, { method: "POST" }));
    expect(run).toMatchObject({ status: "succeeded", trigger: "manual" });
    const snap = await json(await t.call("/v1/snapshot"));
    expect(snap.devices.find((d: { id: string }) => d.id === "demo-lights:keuken-spots").state.on).toBe(true);
    const runs = await json(await t.call(`/v1/automations/runs?automationId=${a.id}`));
    expect(runs.runs[0].steps.map((s: { ok: boolean }) => s.ok)).toEqual([true, true]);
    const notes = await json(await t.call("/v1/notifications"));
    expect(notes.notifications[0].title).toMatch(/^Spots staan aan om \d\d:\d\d$/);
    const audit = await json(await t.call("/v1/audit?limit=10"));
    expect(audit.entries.some((e: { source: string; action: string }) => e.source === "automation" && e.action === "device.command")).toBe(true);
  });

  it("blokkeert runs tijdens de noodstop en respecteert meldingsvoorkeuren", async () => {
    t = await startTestConnector();
    const a = await json(await t.call("/v1/automations", { method: "POST", body: JSON.stringify({ name: "Melding", trigger: { type: "manual" }, actions: [{ type: "notify", category: "energy", title: "Test" }] }) }));
    await t.call("/v1/emergency-stop", { method: "POST", body: JSON.stringify({ active: true }) });
    expect((await json(await t.call(`/v1/automations/${a.id}/run`, { method: "POST" }))).status).toBe("blocked");
    await t.call("/v1/emergency-stop", { method: "POST", body: JSON.stringify({ active: false }) });
    await t.call("/v1/notifications/preferences", { method: "PUT", body: JSON.stringify({ energy: false }) });
    expect((await json(await t.call("/v1/notifications/preferences"))).energy).toBe(false);
    expect((await json(await t.call(`/v1/automations/${a.id}/run`, { method: "POST" }))).status).toBe("succeeded");
    expect((await json(await t.call("/v1/notifications"))).notifications).toEqual([]);
  });

  it("pauzeert, wijzigt en verwijdert, en bewaart na een herstart", async () => {
    t = await startTestConnector();
    const a = await json(await t.call("/v1/automations", { method: "POST", body: JSON.stringify({ name: "Test", trigger: { type: "time", at: "07:00" }, actions: [{ type: "report", kind: "energy" }] }) }));
    expect((await json(await t.call(`/v1/automations/${a.id}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) }))).enabled).toBe(false);
    expect((await t.call(`/v1/automations/${a.id}`, { method: "PATCH", body: JSON.stringify({ trigger: { type: "time", at: "99:00" } }) })).status).toBe(400);
    const dir = t.dataDir;
    await t.close(false);
    t = await startTestConnector({ dataDir: dir });
    const list = await json(await t.call("/v1/automations"));
    expect(list.automations[0]).toMatchObject({ name: "Test", enabled: false });
    expect((await t.call(`/v1/automations/${a.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await json(await t.call("/v1/automations"))).automations).toEqual([]);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { createConnector } from "../src/app";
import type { ConnectorConfig } from "../src/config";
import { memoryStorage, registerStorage, unregisterStorage } from "../src/fs-utils";
import { silent } from "./helpers";

const PREFIX = "db://11111111-2222-4333-8444-555555555555";
afterEach(() => unregisterStorage(PREFIX));

const config = (o: Partial<ConnectorConfig> = {}): ConnectorConfig => ({
  host: "127.0.0.1",
  port: 0,
  dataDir: PREFIX,
  demo: true,
  masterSecret: "een-lange-geheime-sleutel-voor-de-test-1234567890",
  pollIntervalMs: 60_000,
  rateLimitPerMin: 1000,
  commandLimitPerMin: 1000,
  production: false,
  serverless: true,
  ...o,
});

/** Eén "aanvraag" zoals in een serverless functie: opbouwen, iets doen, wegschrijven, afbreken. */
async function request<T>(fn: (c: Awaited<ReturnType<typeof createConnector>>, call: (p: string, init?: RequestInit) => Promise<Response>) => Promise<T>): Promise<T> {
  const c = await createConnector(config(), silent);
  const addr = await c.start();
  const call = (p: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${addr.port}${p}`, { ...init, headers: { authorization: `Bearer ${c.identity.apiToken}`, "content-type": "application/json" } });
  try {
    return await fn(c, call);
  } finally {
    await c.flush();
    await c.stop();
  }
}

describe("cloudmodus (serverless connector)", () => {
  it("bewaart registry, apparaatstatus, auditlog en geheimen in de opslag tussen aanvragen", async () => {
    const storage = memoryStorage();
    registerStorage(PREFIX, storage);

    const token1 = await request(async (c, call) => {
      const r = await call(`/v1/devices/${encodeURIComponent("demo-lights:badkamer-spiegel")}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "set_power", on: true }, source: "user" }) });
      expect(r.status).toBe(200);
      const room = await call("/v1/rooms", { method: "POST", body: JSON.stringify({ name: "Zolder" }) });
      expect(room.status).toBe(200);
      return c.identity.apiToken;
    });

    await request(async (c, call) => {
      expect(c.identity.apiToken).toBe(token1); // zelfde identiteit
      const snap = await (await call("/v1/snapshot")).json();
      expect(snap.devices.find((d: { id: string }) => d.id === "demo-lights:badkamer-spiegel").state.on).toBe(true);
      expect(snap.rooms.some((r: { name: string }) => r.name === "Zolder")).toBe(true);
      const audit = await (await call("/v1/audit?limit=20")).json();
      expect(audit.entries.some((e: { action: string; ok: boolean }) => e.action === "device.command" && e.ok)).toBe(true);
    });

    // Geheimen versleuteld, geen bestanden of sleutelbestand nodig.
    expect([...storage.docs.keys()]).toEqual(expect.arrayContaining(["registry.json", "identity.json"]));
    expect(storage.docs.has("master.key")).toBe(false);
  });

  it("lokale integraties zijn niet beschikbaar; meldt de modus", async () => {
    registerStorage(PREFIX, memoryStorage());
    await request(async (_c, call) => {
      const list = await (await call("/v1/integrations")).json();
      expect(list.mode).toBe("cloud");
      expect((await call("/v1/integrations/hue/discover", { method: "POST" })).status).toBe(409);
      expect((await call("/v1/integrations/webos/pair", { method: "POST", body: "{}" })).status).toBe(409);
      expect((await call("/v1/cameras")).status).toBe(409);
    });
  });

  it("automatiseringen: tick via de geplande taak, toestand blijft bewaard (geen dubbele runs)", async () => {
    registerStorage(PREFIX, memoryStorage());
    const id = await request(async (_c, call) => {
      const r = await call("/v1/automations", {
        method: "POST",
        body: JSON.stringify({ name: "Handmatig", enabled: true, trigger: { type: "manual" }, conditions: [], actions: [{ type: "notify", category: "automation", title: "Test", body: "Hallo" }], cooldownMinutes: 0, maxRunsPerDay: 10 }),
      });
      expect(r.status).toBe(200);
      return ((await r.json()) as { id: string }).id;
    });
    await request(async (c, call) => {
      expect((await call(`/v1/automations/${id}/run`, { method: "POST" })).status).toBe(200);
      await c.automations.tick();
    });
    await request(async (_c, call) => {
      const runs = await (await call("/v1/automations/runs")).json();
      expect(runs.runs.length).toBe(1);
      const notes = await (await call("/v1/notifications")).json();
      expect(notes.notifications[0]).toMatchObject({ title: "Test" });
    });
  });

  it("weigert de cloudmodus zonder sleutel voor de versleutelde opslag", async () => {
    registerStorage(PREFIX, memoryStorage());
    await expect(createConnector(config({ masterSecret: null }), silent)).rejects.toThrow(/HOMEOS_CONNECTOR_SECRET/);
  });
});

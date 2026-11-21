import { afterEach, describe, expect, it } from "vitest";
import { createConnector } from "../src/app";
import type { ConnectorConfig } from "../src/config";
import { memoryStorage, registerStorage, unregisterStorage } from "../src/fs-utils";
import { silent } from "./helpers";
import { fakeZiggo } from "../../../packages/integrations/test/fake-ziggo";

const PREFIX = "db://66666666-2222-4333-8444-555555555555";
afterEach(() => unregisterStorage(PREFIX));
const config: ConnectorConfig = { host: "127.0.0.1", port: 0, dataDir: PREFIX, demo: false, masterSecret: "een-lange-geheime-sleutel-voor-de-test-1234567890", pollIntervalMs: 60_000, rateLimitPerMin: 1000, commandLimitPerMin: 1000, production: false, serverless: true };

async function request<T>(z: ReturnType<typeof fakeZiggo>, fn: (call: (p: string, init?: RequestInit) => Promise<Response>) => Promise<T>): Promise<T> {
  const c = await createConnector(config, silent, [], undefined, z.fetchImpl, undefined, undefined, undefined, undefined, undefined, z.mqttConnect);
  const addr = await c.start();
  const call = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${addr.port}${p}`, { ...init, headers: { authorization: `Bearer ${c.identity.apiToken}`, "content-type": "application/json" } });
  try {
    return await fn(call);
  } finally {
    await c.flush();
    await c.stop();
  }
}

describe("Ziggo Mediabox (niet-officieel, cloudmodus)", () => {
  it("koppelt, toont de box als mediaspeler met zenders, kiest een zender en ontkoppelt", async () => {
    const storage = memoryStorage();
    registerStorage(PREFIX, storage);
    const z = fakeZiggo({ startState: "ONLINE_RUNNING" });
    await request(z, async (call) => {
      const post = (b: unknown) => call("/v1/integrations/ziggo", { method: "POST", body: JSON.stringify(b) });
      expect((await post({ username: "geen-mail", password: "x" })).status).toBe(400);
      expect((await post({ username: z.user, password: "fout-wachtwoord" })).status).toBe(401);
      const ok = await post({ username: z.user, password: z.password });
      expect(ok.status).toBe(200);
      expect((await ok.json()).boxes).toEqual(["Ziggo woonkamer"]);
    });
    const stored = JSON.stringify([...storage.docs.values()]);
    expect(stored).not.toContain(z.password);
    expect(stored).not.toContain("acc-1");

    const id = `ziggo:${z.box}`;
    await request(z, async (call) => {
      const list = await (await call("/v1/integrations")).json();
      expect(list.ziggo).toMatchObject({ connected: true, unofficial: true, boxes: ["Ziggo woonkamer"] });
      await call(`/v1/devices/${encodeURIComponent(id)}/sync`, { method: "POST" });
      const snap = await (await call("/v1/snapshot")).json();
      const dev = snap.devices.find((d: { id: string }) => d.id === id);
      expect(dev).toMatchObject({ kind: "media", integration: "ziggo", status: "ONLINE" });
      expect(dev.brand).toContain("niet-officieel");
      expect(dev.state.media.sources.some((s: { type: string }) => s.type === "channel")).toBe(true);
      const cmd = await call(`/v1/devices/${encodeURIComponent(id)}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "select_source", sourceId: "NL_000002_019402" }, source: "user" }) });
      expect(cmd.status).toBe(200);
      expect((await cmd.json()).device.state.media.title).toBe("2. NPO 2");
    });
    expect(z.state.box.channelId).toBe("NL_000002_019402");

    await request(z, async (call) => {
      expect((await call("/v1/integrations/ziggo", { method: "DELETE" })).status).toBe(200);
      const snap = await (await call("/v1/snapshot")).json();
      expect(snap.devices.some((d: { id: string }) => d.id === id)).toBe(false);
    });
  });
});

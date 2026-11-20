import { afterEach, describe, expect, it } from "vitest";
import { createConnector } from "../src/app";
import type { ConnectorConfig } from "../src/config";
import { memoryStorage, registerStorage, unregisterStorage } from "../src/fs-utils";
import { silent } from "./helpers";
import { fakeHueCloud } from "../../../packages/integrations/test/fake-huecloud";

const PREFIX = "db://22222222-2222-4333-8444-555555555555";
afterEach(() => unregisterStorage(PREFIX));
const config: ConnectorConfig = { host: "127.0.0.1", port: 0, dataDir: PREFIX, demo: false, masterSecret: "een-lange-geheime-sleutel-voor-de-test-1234567890", pollIntervalMs: 60_000, rateLimitPerMin: 1000, commandLimitPerMin: 1000, production: false, serverless: true };

async function request<T>(f: typeof fetch, fn: (call: (p: string, init?: RequestInit) => Promise<Response>) => Promise<T>): Promise<T> {
  const c = await createConnector(config, silent, [], undefined, f);
  const addr = await c.start();
  const call = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${addr.port}${p}`, { ...init, headers: { authorization: `Bearer ${c.identity.apiToken}`, "content-type": "application/json" } });
  try {
    return await fn(call);
  } finally {
    await c.flush();
    await c.stop();
  }
}

describe("Philips Hue via de Hue-cloud (cloudmodus)", () => {
  it("koppelt via OAuth (state gecontroleerd), maakt een app-key, bedient lampen en vernieuwt tokens", async () => {
    const storage = memoryStorage();
    registerStorage(PREFIX, storage);
    const hue = fakeHueCloud();

    const url = await request(hue.fetchImpl, async (call) => {
      const r = await call("/v1/integrations/huecloud/start", { method: "POST", body: JSON.stringify({ clientId: "cid", clientSecret: "csecret" }) });
      expect(r.status).toBe(200);
      return new URL((await r.json()).authorizeUrl as string);
    });
    expect(url.origin + url.pathname).toBe("https://api.meethue.com/v2/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    const state = url.searchParams.get("state")!;

    // Volgende aanvraag (nieuwe connector): de koppelpoging is bewaard.
    await request(hue.fetchImpl, async (call) => {
      expect((await call("/v1/integrations/huecloud/complete", { method: "POST", body: JSON.stringify({ code: "goede-code", state: "verkeerd" }) })).status).toBe(400);
      const ok = await call("/v1/integrations/huecloud/complete", { method: "POST", body: JSON.stringify({ code: "goede-code", state }) });
      expect(ok.status).toBe(200);
    });
    expect(hue.state.linked).toBe(true);
    expect(JSON.stringify([...storage.docs.values()])).not.toContain("csecret");
    expect(JSON.stringify([...storage.docs.values()])).not.toContain("acc-1");

    await request(hue.fetchImpl, async (call) => {
      const snap = await (await call("/v1/snapshot")).json();
      const lamp = snap.devices.find((d: { id: string }) => d.id === "huecloud:l-1");
      expect(lamp).toMatchObject({ name: "Plafond", status: "ONLINE" });
      const cmd = await call(`/v1/devices/${encodeURIComponent("huecloud:l-1")}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "set_power", on: true }, source: "user" }) });
      expect(cmd.status).toBe(200);
    });
    expect(hue.bridge.puts[0]).toMatchObject({ path: "/clip/v2/resource/light/l-1", body: { on: { on: true } } });

    // Verlopen token: één keer vernieuwen en opnieuw proberen.
    hue.state.expireNext = true;
    await request(hue.fetchImpl, async (call) => {
      const cmd = await call(`/v1/devices/${encodeURIComponent("huecloud:l-1")}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "set_brightness", brightness: 40 }, source: "user" }) });
      expect(cmd.status).toBe(200);
    });
    expect(hue.state.access).toBe("acc-2");

    await request(hue.fetchImpl, async (call) => {
      expect((await call("/v1/integrations/huecloud", { method: "DELETE" })).status).toBe(200);
      const snap = await (await call("/v1/snapshot")).json();
      expect(snap.devices.some((d: { id: string }) => d.id.startsWith("huecloud:"))).toBe(false);
    });
  });
});

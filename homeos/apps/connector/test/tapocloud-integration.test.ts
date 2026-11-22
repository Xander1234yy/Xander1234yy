import { afterEach, describe, expect, it } from "vitest";
import { createConnector } from "../src/app";
import type { ConnectorConfig } from "../src/config";
import { memoryStorage, registerStorage, unregisterStorage } from "../src/fs-utils";
import { silent } from "./helpers";
import { fakeTapoCloud } from "../../../packages/integrations/test/fake-tapocloud";

const PREFIX = "db://77777777-2222-4333-8444-555555555555";
afterEach(() => unregisterStorage(PREFIX));
const config: ConnectorConfig = { host: "127.0.0.1", port: 0, dataDir: PREFIX, demo: false, masterSecret: "een-lange-geheime-sleutel-voor-de-test-1234567890", pollIntervalMs: 60_000, rateLimitPerMin: 1000, commandLimitPerMin: 1000, production: false, serverless: true };

async function request<T>(f: ReturnType<typeof fakeTapoCloud>, fn: (call: (p: string, init?: RequestInit) => Promise<Response>) => Promise<T>): Promise<T> {
  const c = await createConnector(config, silent, [], undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, f.http, f.relaySocket);
  const addr = await c.start();
  const call = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${addr.port}${p}`, { ...init, headers: { authorization: `Bearer ${c.identity.apiToken}`, "content-type": "application/json" } });
  try {
    return await fn(call);
  } finally {
    await c.flush();
    await c.stop();
  }
}

describe("Tapo-camera's via TP-Link-cloud (niet-officieel, cloudmodus)", () => {
  it("koppelt met verificatiecode, toont camera en deurbel, bedient de privacymodus en ontkoppelt", async () => {
    const storage = memoryStorage();
    registerStorage(PREFIX, storage);
    const f = fakeTapoCloud({ mfa: true });
    await request(f, async (call) => {
      const r = await call("/v1/integrations/tapocloud", { method: "POST", body: JSON.stringify({ email: f.user, password: f.password }) });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ ok: false, mfa: true, via: "app" });
    });
    // Volgende aanvraag (serverless): de koppelpoging is versleuteld bewaard.
    await request(f, async (call) => {
      expect((await call("/v1/integrations/tapocloud/verify", { method: "POST", body: JSON.stringify({ code: "000000" }) })).status).toBe(401);
      const ok = await call("/v1/integrations/tapocloud/verify", { method: "POST", body: JSON.stringify({ code: "123456" }) });
      expect(ok.status).toBe(200);
      expect((await ok.json()).cameras).toEqual(["Tuin C500", "Voordeur"]);
    });
    const stored = JSON.stringify([...storage.docs.values()]);
    expect(stored).not.toContain(f.password);
    expect(stored).not.toContain("tok-1");

    const cam = `tapocloud:${f.CAM}`;
    const bell = `tapocloud:${f.BELL}`;
    await request(f, async (call) => {
      const list = await (await call("/v1/integrations")).json();
      expect(list.tapocloud).toMatchObject({ connected: true, unofficial: true, cameras: ["Tuin C500", "Voordeur"] });
      const snap = await (await call("/v1/snapshot")).json();
      expect(snap.devices.find((d: { id: string }) => d.id === cam)).toMatchObject({ kind: "camera", integration: "tapo_camera", capabilities: ["motion", "onoff", "ptz", "cloud_stream"] });
      expect(snap.devices.find((d: { id: string }) => d.id === bell)).toMatchObject({ kind: "doorbell", capabilities: ["motion", "doorbell", "cloud_stream"] });
      const off = await call(`/v1/devices/${encodeURIComponent(cam)}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "set_power", on: false }, source: "user" }) });
      expect(off.status).toBe(200);
      // Automatiseringen en Jarvis mogen camera's niet bedienen (veiligheidskritisch).
      const auto = await call(`/v1/devices/${encodeURIComponent(cam)}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "set_power", on: true }, source: "automation" }) });
      expect(auto.status).not.toBe(200);
    });
    expect(f.state.privacy).toBe("on");
    expect(f.state.badSignatures).toBe(0);

    // Live beeld via het relais (cloudmodus), als MPEG-TS.
    await request(f, async (call) => {
      expect((await call(`/v1/cameras/tapocloud/0000000000000000/live`)).status).toBe(404); // onbekend
      const live = await call(`/v1/cameras/tapocloud/${f.CAM}/live`);
      expect(live.status).toBe(200);
      expect(live.headers.get("content-type")).toBe("video/mp2t");
      expect(live.headers.get("x-audio-codec")).toBe("alaw");
      expect(live.headers.get("x-audio-rate")).toBe("8000");
      const bytes = Buffer.from(await live.arrayBuffer());
      expect(bytes.length).toBe(26 * 188);
      expect(bytes[0]).toBe(0x47);
      const audit = await (await call("/v1/audit")).json();
      expect(JSON.stringify(audit)).toContain("camera.view");
    });

    await request(f, async (call) => {
      expect((await call("/v1/integrations/tapocloud", { method: "DELETE" })).status).toBe(200);
      const snap = await (await call("/v1/snapshot")).json();
      expect(snap.devices.some((d: { id: string }) => d.id === cam)).toBe(false);
    });
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { createConnector } from "../src/app";
import type { ConnectorConfig } from "../src/config";
import { memoryStorage, registerStorage, unregisterStorage } from "../src/fs-utils";
import { silent } from "./helpers";
import { fakeIcloud } from "../../../packages/integrations/test/fake-icloud";

const PREFIX = "db://44444444-2222-4333-8444-555555555555";
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

describe("Apple iCloud-agenda (cloudmodus)", () => {
  it("koppelt met een app-specifiek wachtwoord, bewaart het versleuteld, toont afspraken en laat agenda's kiezen", async () => {
    const storage = memoryStorage();
    registerStorage(PREFIX, storage);
    const icloud = fakeIcloud();

    await request(icloud.fetchImpl, async (call) => {
      const post = (b: unknown) => call("/v1/integrations/icloud", { method: "POST", body: JSON.stringify(b) });
      expect((await post({ appleId: "geen-mail", appPassword: icloud.password })).status).toBe(400);
      // Gewoon Apple-wachtwoord wordt geweigerd (alleen app-specifieke wachtwoorden).
      expect((await post({ appleId: icloud.user, appPassword: "MijnWachtwoord123!" })).status).toBe(400);
      expect((await post({ appleId: icloud.user, appPassword: "zzzz-zzzz-zzzz-zzzz" })).status).toBe(401);
      const ok = await post({ appleId: icloud.user, appPassword: icloud.password.toUpperCase() });
      expect(ok.status).toBe(200);
      expect((await ok.json()).calendars.map((c: { name: string; enabled: boolean }) => [c.name, c.enabled])).toEqual([
        ["Thuis & gezin", true],
        ["Werk", true],
      ]);
    });
    const stored = JSON.stringify([...storage.docs.values()]);
    expect(stored).not.toContain(icloud.password);
    expect(stored).not.toContain(icloud.user);

    await request(icloud.fetchImpl, async (call) => {
      const r = await (await call("/v1/calendar/events")).json();
      expect(r.connected).toBe(true);
      expect(r.error).toBeNull();
      expect(Array.isArray(r.events)).toBe(true);
      const list = await (await call("/v1/integrations")).json();
      expect(list.icloud).toMatchObject({ connected: true });
      expect(JSON.stringify(list)).not.toContain(icloud.password);
    });

    // Binnen 10 minuten geen nieuwe aanvraag naar iCloud (gegevens uit de opslag).
    const before = icloud.state.requests.length;
    await request(icloud.fetchImpl, async (call) => {
      await call("/v1/calendar/events");
    });
    expect(icloud.state.requests.length).toBe(before);

    await request(icloud.fetchImpl, async (call) => {
      const r = await call("/v1/integrations/icloud/calendars", { method: "PUT", body: JSON.stringify({ enabled: ["https://p42-caldav.icloud.com/123456/calendars/work/"] }) });
      expect(r.status).toBe(200);
      expect((await r.json()).calendars.map((c: { enabled: boolean }) => c.enabled)).toEqual([false, true]);
      const reports = icloud.state.requests.filter((x) => x.method === "REPORT").slice(-1);
      expect(reports[0]!.url).toContain("/calendars/work/");
    });

    await request(icloud.fetchImpl, async (call) => {
      expect((await call("/v1/integrations/icloud", { method: "DELETE" })).status).toBe(200);
      expect(await (await call("/v1/calendar/events")).json()).toMatchObject({ connected: false, events: [] });
    });
  });
});

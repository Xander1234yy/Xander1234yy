import { afterEach, describe, expect, it } from "vitest";
import type { AssistantTransport } from "@homeos/integrations";
import { createConnector } from "../src/app";
import type { ConnectorConfig } from "../src/config";
import { memoryStorage, registerStorage, unregisterStorage } from "../src/fs-utils";
import { deviceIdFor, validRedirectUri } from "../src/googlehome-service";
import { silent } from "./helpers";

const PREFIX = "db://33333333-2222-4333-8444-555555555555";
afterEach(() => unregisterStorage(PREFIX));
const config: ConnectorConfig = { host: "127.0.0.1", port: 0, dataDir: PREFIX, demo: false, masterSecret: "een-lange-geheime-sleutel-voor-de-test-1234567890", pollIntervalMs: 60_000, rateLimitPerMin: 1000, commandLimitPerMin: 1000, production: false, serverless: true };
const REDIRECT = "https://homeos.example.app/api/integrations/googlehome/callback";
const CLIENT = "1234567890-abc.apps.googleusercontent.com";

/** Nep-Google: alleen het token-adres, nooit het echte netwerk. */
function fakeGoogle() {
  const state = { exchanged: 0, lastBody: "" };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    if (String(url) !== "https://oauth2.googleapis.com/token") return new Response("nee", { status: 404 });
    state.lastBody = String(init.body);
    const p = new URLSearchParams(state.lastBody);
    if (p.get("code") !== "goede-code") return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    state.exchanged += 1;
    return new Response(JSON.stringify({ access_token: "acc-google-1", refresh_token: "ref-google-1", expires_in: 3600 }), { status: 200 });
  }) as unknown as typeof fetch;
  return { state, fetchImpl };
}

async function request<T>(f: typeof fetch, transport: AssistantTransport, fn: (call: (p: string, init?: RequestInit) => Promise<Response>) => Promise<T>): Promise<T> {
  const c = await createConnector(config, silent, [], undefined, f, undefined, undefined, undefined, undefined, transport);
  const addr = await c.start();
  const call = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${addr.port}${p}`, { ...init, headers: { authorization: `Bearer ${c.identity.apiToken}`, "content-type": "application/json" } });
  try {
    return await fn(call);
  } finally {
    await c.flush();
    await c.stop();
  }
}

describe("Google Home via de Google Assistant SDK (cloudmodus)", () => {
  it("controleert de terugkoppel-URL", () => {
    expect(validRedirectUri(REDIRECT)).toBe(true);
    expect(validRedirectUri("http://localhost:3000/api/integrations/googlehome/callback")).toBe(true);
    expect(validRedirectUri("http://homeos.example.app/api/integrations/googlehome/callback")).toBe(false);
    expect(validRedirectUri("https://evil.example/api/other")).toBe(false);
    expect(validRedirectUri(`${REDIRECT}?x=1`)).toBe(false);
    expect(validRedirectUri("javascript:alert(1)")).toBe(false);
  });

  it("koppelt via OAuth, voegt apparaten toe en stuurt opdrachten als tekst zonder gegokte status", async () => {
    const storage = memoryStorage();
    registerStorage(PREFIX, storage);
    const google = fakeGoogle();
    const sent: { token: string; text: string; lang: string }[] = [];
    const transport: AssistantTransport = async (token, text, lang) => (sent.push({ token, text, lang }), { text: "Oké" });

    const url = await request(google.fetchImpl, transport, async (call) => {
      expect((await call("/v1/integrations/googlehome/start", { method: "POST", body: JSON.stringify({ clientId: "fout", clientSecret: "geheim-123", redirectUri: REDIRECT }) })).status).toBe(400);
      expect((await call("/v1/integrations/googlehome/start", { method: "POST", body: JSON.stringify({ clientId: CLIENT, clientSecret: "geheim-123", redirectUri: "https://evil.example/x" }) })).status).toBe(400);
      const r = await call("/v1/integrations/googlehome/start", { method: "POST", body: JSON.stringify({ clientId: CLIENT, clientSecret: "geheim-123", redirectUri: REDIRECT }) });
      expect(r.status).toBe(200);
      return new URL((await r.json()).authorizeUrl as string);
    });
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    const state = url.searchParams.get("state")!;

    await request(google.fetchImpl, transport, async (call) => {
      expect((await call("/v1/integrations/googlehome/complete", { method: "POST", body: JSON.stringify({ code: "goede-code", state: "verkeerd" }) })).status).toBe(400);
      expect((await call("/v1/integrations/googlehome/complete", { method: "POST", body: JSON.stringify({ code: "foute-code", state }) })).status).toBe(401);
      expect((await call("/v1/integrations/googlehome/complete", { method: "POST", body: JSON.stringify({ code: "goede-code", state }) })).status).toBe(200);
      // Tweede keer dezelfde terugkoppeling: de poging is op.
      expect((await call("/v1/integrations/googlehome/complete", { method: "POST", body: JSON.stringify({ code: "goede-code", state }) })).status).toBe(409);
    });
    expect(google.state.lastBody).toContain(encodeURIComponent(REDIRECT));
    const stored = JSON.stringify([...storage.docs.values()]);
    expect(stored).not.toContain("geheim-123");
    expect(stored).not.toContain("acc-google-1");
    expect(stored).not.toContain("ref-google-1");

    const id = `googlehome:${deviceIdFor("GRILLPLATS")}`;
    await request(google.fetchImpl, transport, async (call) => {
      expect((await call("/v1/integrations/googlehome/devices", { method: "PUT", body: JSON.stringify({ names: ["<script>"] }) })).status).toBe(400);
      const r = await call("/v1/integrations/googlehome/devices", { method: "PUT", body: JSON.stringify({ names: ["GRILLPLATS", " GRILLPLATS ", "Lamp bank"] }) });
      expect(r.status).toBe(200);
      expect((await r.json()).devices).toEqual(["GRILLPLATS", "Lamp bank"]);
    });

    await request(google.fetchImpl, transport, async (call) => {
      const list = await (await call("/v1/integrations")).json();
      expect(list.googlehome).toMatchObject({ connected: true, devices: ["GRILLPLATS", "Lamp bank"] });
      const snap = await (await call("/v1/snapshot")).json();
      const plug = snap.devices.find((d: { id: string }) => d.id === id);
      expect(plug).toMatchObject({ name: "GRILLPLATS", status: "ONLINE", kind: "plug", capabilities: ["onoff"] });
      expect(plug.state.on).toBeUndefined();
      const cmd = await call(`/v1/devices/${encodeURIComponent(id)}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "set_power", on: true }, source: "user" }) });
      expect(cmd.status).toBe(200);
      const after = await (await call("/v1/snapshot")).json();
      expect(after.devices.find((d: { id: string }) => d.id === id).state.on).toBeUndefined();
      const audit = await (await call("/v1/audit")).json();
      expect(JSON.stringify(audit)).toContain(id);
    });
    expect(sent).toEqual([{ token: "acc-google-1", text: "turn on GRILLPLATS", lang: "en-US" }]);

    await request(google.fetchImpl, transport, async (call) => {
      expect((await call("/v1/integrations/googlehome", { method: "DELETE" })).status).toBe(200);
      const snap = await (await call("/v1/snapshot")).json();
      expect(snap.devices.some((d: { id: string }) => d.id === id)).toBe(false);
      expect((await (await call("/v1/integrations")).json()).googlehome).toEqual({ connected: false });
    });
  });
});

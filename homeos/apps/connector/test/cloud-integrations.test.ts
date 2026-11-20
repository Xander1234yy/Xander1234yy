import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startTestConnector } from "./helpers";

type T = Awaited<ReturnType<typeof startTestConnector>>;
let t: T | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

/** Nagebootste SolarEdge- en Daikin-API's. Er gaat niets naar het echte internet. */
const fakeCloud = (async (input: string | URL, init: RequestInit = {}) => {
  const url = new URL(String(input));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.host === "monitoringapi.solaredge.com") {
    if (url.searchParams.get("api_key") !== "GOEDEKEY12345678") return json({}, 403);
    if (url.pathname.endsWith("/details")) return json({ details: { id: 42, name: "Dak", status: "Active", peakPower: 4.8, location: { timeZone: "Europe/Amsterdam" } } });
    if (url.pathname.endsWith("/overview")) return json({ overview: { lastUpdateTime: "2026-11-20 12:00:00", lifeTimeData: { energy: 1 }, lastYearData: { energy: 2_000_000 }, lastMonthData: { energy: 80_000 }, lastDayData: { energy: 3_100 }, currentPower: { power: 900 } } });
  }
  if (url.host === "idp.onecta.daikineurope.com") {
    const body = new URLSearchParams(String(init.body));
    if (body.get("code") !== "geldige-code") return json({ error: "invalid_grant" }, 400);
    return json({ access_token: "acc-TOKEN", refresh_token: "ref-TOKEN", expires_in: 3600 });
  }
  if (url.host === "api.onecta.daikineurope.com" && url.pathname === "/v1/gateway-devices") {
    return json([{ id: "unit-1", managementPoints: [{ embeddedId: "climateControl", managementPointType: "climateControl", name: { value: "Woonkamer airco" }, onOffMode: { value: "on", settable: true }, operationMode: { value: "heating", values: ["heating", "cooling"], settable: true }, temperatureControl: { value: { operationModes: { heating: { setpoints: { roomTemperature: { value: 21, minValue: 10, maxValue: 30, stepValue: 0.5, settable: true } } } } } }, sensoryData: { value: { roomTemperature: { value: 20.5 } } } }] }]);
  }
  return json({}, 404);
}) as typeof fetch;

describe("SolarEdge in de connector", () => {
  it("valideert de key, voegt de installatie toe en levert echte (niet-demo) energiegegevens", async () => {
    t = await startTestConnector({ demo: true }, undefined, fakeCloud);
    const bad = await t.call("/v1/integrations/solaredge", { method: "POST", body: JSON.stringify({ siteId: "42", apiKey: "FOUTEKEY12345678" }) });
    expect(bad.status).toBe(400);
    const ok = await t.call("/v1/integrations/solaredge", { method: "POST", body: JSON.stringify({ siteId: "42", apiKey: "GOEDEKEY12345678" }) });
    expect(ok.status).toBe(200);
    expect(await ok.text()).not.toContain("GOEDEKEY");
    const summary = await (await t.call("/v1/energy/summary")).json();
    expect(summary).toMatchObject({ demo: false, sourceId: "solaredge-42", currentProductionW: 900, currentConsumptionW: null });
    const snap = await (await t.call("/v1/snapshot")).json();
    expect(snap.devices.find((d: { brand: string }) => d.brand === "SolarEdge")).toMatchObject({ status: "ONLINE", refreshIntervalMs: 600000 });
    for (const f of ["integrations.json", "registry.json", "secrets.enc"]) expect(await readFile(path.join(t.dataDir, f), "utf8")).not.toContain("GOEDEKEY");
    expect((await t.call("/v1/integrations/solaredge/42", { method: "DELETE" })).status).toBe(200);
    expect((await (await t.call("/v1/energy/summary")).json()).demo).toBe(true);
  });
});

describe("Daikin Onecta in de connector", () => {
  const start = (redirectUri = "https://homeos.example/integraties/daikin") =>
    t!.call("/v1/integrations/daikin/start", { method: "POST", body: JSON.stringify({ clientId: "cid", clientSecret: "GEHEIM-SECRET", redirectUri }) });

  it("weigert ongeldige redirect-URI's", async () => {
    t = await startTestConnector({ demo: false }, undefined, fakeCloud);
    expect((await start("http://homeos.example/cb")).status).toBe(400);
    expect((await start("https://127.0.0.1/cb")).status).toBe(400);
  });

  it("koppelt via OAuth met state-controle en voegt de airco toe", async () => {
    t = await startTestConnector({ demo: false }, undefined, fakeCloud);
    const s = await (await start()).json();
    const auth = new URL(s.authorizeUrl);
    const state = auth.searchParams.get("state")!;
    expect(auth.searchParams.get("client_id")).toBe("cid");

    const wrongState = await t.call("/v1/integrations/daikin/complete", { method: "POST", body: JSON.stringify({ callbackUrl: `https://homeos.example/integraties/daikin?code=geldige-code&state=vals` }) });
    expect((await wrongState.json()).error.code).toBe("STATE_MISMATCH");
    const otherHost = await t.call("/v1/integrations/daikin/complete", { method: "POST", body: JSON.stringify({ callbackUrl: `https://evil.example/cb?code=geldige-code&state=${state}` }) });
    expect(otherHost.status).toBe(400);

    const ok = await t.call("/v1/integrations/daikin/complete", { method: "POST", body: JSON.stringify({ callbackUrl: `https://homeos.example/integraties/daikin?code=geldige-code&state=${state}` }) });
    expect(ok.status).toBe(200);
    const snap = await (await t.call("/v1/snapshot")).json();
    const airco = snap.devices.find((d: { kind: string }) => d.kind === "climate");
    expect(airco).toMatchObject({ name: "Woonkamer airco", brand: "Daikin", status: "ONLINE", capabilities: ["onoff", "climate"] });
    expect(airco.state.climate).toMatchObject({ mode: "heating", targetTempC: 21, roomTempC: 20.5, outdoorTempC: null });
    for (const f of ["integrations.json", "registry.json", "secrets.enc"]) {
      const raw = await readFile(path.join(t.dataDir, f), "utf8");
      expect(raw).not.toContain("GEHEIM-SECRET");
      expect(raw).not.toContain("ref-TOKEN");
    }
    const list = await (await t.call("/v1/integrations")).json();
    expect(JSON.stringify(list)).not.toMatch(/GEHEIM|TOKEN/);
    expect((await t.call("/v1/integrations/daikin", { method: "DELETE" })).status).toBe(200);
    expect((await (await t.call("/v1/snapshot")).json()).devices).toEqual([]);
  });
});

describe("Tuya in de connector", () => {
  it("valideert, slaat de secret versleuteld op en voegt stekkers toe", async () => {
    const { tuyaSign, tuyaStringToSign } = await import("@homeos/integrations");
    const tuyaFetch = (async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const h = init.headers as Record<string, string>;
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      const ok = tuyaSign(h.client_id!, "GOEDSECRET123456", h.t!, tuyaStringToSign(init.method ?? "GET", url.pathname, Object.fromEntries(url.searchParams), init.body ? JSON.parse(String(init.body)) : undefined), h.access_token ?? "") === h.sign;
      if (!ok) return json({ success: false, code: 1004, msg: "sign invalid" });
      if (url.pathname === "/v1.0/token") return json({ success: true, result: { access_token: "AT", refresh_token: "RT", expire_time: 7200 } });
      if (url.pathname.endsWith("/devices")) return json({ success: true, result: [{ id: "p1", name: "Koelkast", category: "cz", online: true, status: [{ code: "switch_1", value: true }] }] });
      if (url.pathname.endsWith("/specifications")) return json({ success: true, result: { status: [] } });
      return json({ success: false, code: 1108 });
    }) as typeof fetch;
    t = await startTestConnector({ demo: false }, undefined, tuyaFetch);
    const body = (secret: string) => JSON.stringify({ region: "eu", accessId: "abcdefghij1234567890", accessSecret: secret, uid: "eu1234567" });
    const bad = await t.call("/v1/integrations/tuya", { method: "POST", body: body("FOUTSECRET123456") });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toMatch(/handtekening/);
    const ok = await t.call("/v1/integrations/tuya", { method: "POST", body: body("GOEDSECRET123456") });
    expect(await ok.json()).toEqual({ devicesFound: 1 });
    const snap = await (await t.call("/v1/snapshot")).json();
    expect(snap.devices[0]).toMatchObject({ name: "Koelkast", brand: "Smart Life / Tuya", kind: "plug", capabilities: ["onoff"], status: "ONLINE" });
    for (const f of ["integrations.json", "secrets.enc"]) expect(await readFile(path.join(t.dataDir, f), "utf8")).not.toContain("GOEDSECRET");
    expect((await t.call("/v1/integrations/tuya", { method: "DELETE" })).status).toBe(200);
  });
});

describe("Matter in de connector", () => {
  it("koppelt via een code, voegt de stekker toe en ontkoppelt alleen de HomeOS-fabric", async () => {
    const { fakeMatter } = await import("../../../packages/integrations/test/fake-matter");
    const fm = fakeMatter();
    const { createConnector } = await import("../src/app");
    const { tempDir, silent } = await import("./helpers");
    const dataDir = await tempDir();
    const c = await createConnector(
      { host: "127.0.0.1", port: 0, dataDir, demo: false, masterSecret: null, pollIntervalMs: 60_000, rateLimitPerMin: 1000, commandLimitPerMin: 1000, production: false },
      silent,
      [],
      undefined,
      undefined,
      () => fm.backend,
    );
    const addr = await c.start();
    const call = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${addr.port}${p}`, { ...init, headers: { authorization: `Bearer ${c.identity.apiToken}`, "content-type": "application/json" } });
    try {
      expect((await call("/v1/integrations/matter/commission", { method: "POST", body: JSON.stringify({ pairingCode: "nee nee nee" }) })).status).toBe(400);
      const ok = await call("/v1/integrations/matter/commission", { method: "POST", body: JSON.stringify({ pairingCode: "3497-011-2332" }) });
      expect(await ok.json()).toMatchObject({ devicesAdded: 1 });
      const snap = await (await call("/v1/snapshot")).json();
      const plug = snap.devices.find((d: { brand: string }) => d.brand === "IKEA of Sweden");
      expect(plug).toMatchObject({ kind: "plug", status: "ONLINE", state: { on: false, powerW: 12.3 } });
      const cmd = await call(`/v1/devices/${encodeURIComponent(plug.id)}/commands`, { method: "POST", body: JSON.stringify({ command: { type: "set_power", on: true } }) });
      expect((await cmd.json()).device.state.on).toBe(true);
      const list = await (await call("/v1/integrations")).json();
      expect(list.matter.nodes[0]).toMatchObject({ productName: "GRILLPLATS (SIM)", online: true });
      expect((await call(`/v1/integrations/matter/nodes/${list.matter.nodes[0].nodeId}`, { method: "DELETE" })).status).toBe(200);
      expect(fm.calls.some((x) => x.startsWith("remove:"))).toBe(true);
    } finally {
      await c.stop();
    }
  });
});

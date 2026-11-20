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

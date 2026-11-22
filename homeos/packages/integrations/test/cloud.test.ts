import { describe, expect, it } from "vitest";
import { RequestBudget, zonedToIso } from "../src/cloud/budget";
import { SolarEdgeAdapter, validateSolarEdge } from "../src/solaredge/adapter";
import { DaikinAdapter } from "../src/daikin/adapter";
import { authorizeUrl, parseCallbackUrl, validateRedirectUri } from "../src/daikin/oauth";
import type { AdapterContext } from "../src";

type Handler = (url: URL, init: RequestInit) => { status?: number; json?: unknown; headers?: Record<string, string> };
function fakeFetch(handler: Handler) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const f = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  }) as typeof fetch;
  return { f, calls };
}
function ctx(secrets: Record<string, string>): AdapterContext {
  const store = new Map(Object.entries(secrets));
  return {
    logger: { info() {}, warn() {}, error() {} },
    now: () => new Date(),
    emit: () => undefined,
    secrets: { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k) },
  };
}

describe("verzoekbudget", () => {
  it("houdt een reserve vrij voor opdrachten en volgt een 24-uurs venster", () => {
    let now = 0;
    const b = new RequestBudget(10, 3, () => now);
    for (let i = 0; i < 7; i++) b.spend();
    expect(b.canSpend("background")).toBe(false);
    expect(b.canSpend("command")).toBe(true);
    now = 86_400_001;
    expect(b.remaining()).toBe(10);
    b.blockFor(60);
    expect(b.canSpend("command")).toBe(false);
  });
  it("rekent lokale SolarEdge-tijden om naar UTC (incl. zomertijd)", () => {
    expect(zonedToIso("2026-07-01 12:00:00", "Europe/Amsterdam")).toBe("2026-07-01T10:00:00.000Z");
    expect(zonedToIso("2026-01-15 12:00:00", "Europe/Amsterdam")).toBe("2026-01-15T11:00:00.000Z");
  });
});

describe("SolarEdge", () => {
  const overview = { overview: { lastUpdateTime: "2026-11-20 13:45:00", lifeTimeData: { energy: 9_000_000 }, lastYearData: { energy: 3_500_000 }, lastMonthData: { energy: 120_000 }, lastDayData: { energy: 4_250 }, currentPower: { power: 1530.4 } } };
  const handler: Handler = (url) => {
    if (url.pathname.endsWith("/details")) return { json: { details: { id: 1, name: "Thuis", status: "Active", peakPower: 5.2, location: { timeZone: "Europe/Amsterdam" } } } };
    if (url.pathname.endsWith("/overview")) return { json: overview };
    if (url.pathname.endsWith("/energy")) return { json: { energy: { timeUnit: url.searchParams.get("timeUnit"), unit: "Wh", values: [{ date: "2026-11-20 10:00:00", value: 250 }, { date: "2026-11-20 10:15:00", value: null }] } } };
    return { status: 404 };
  };

  it("valideert invoer en haalt site-gegevens op", async () => {
    const { f, calls } = fakeFetch(handler);
    await expect(validateSolarEdge("abc", "X".repeat(32), f)).rejects.toThrow(/cijfers/);
    const cfg = await validateSolarEdge("123456", "ABCDEFGHIJKLMNOP1234", f);
    expect(cfg).toEqual({ siteId: "123456", name: "Thuis", timeZone: "Europe/Amsterdam", peakPowerKw: 5.2 });
    expect(calls[0]!.url.searchParams.get("api_key")).toBe("ABCDEFGHIJKLMNOP1234");
    expect(calls[0]!.url.host).toBe("monitoringapi.solaredge.com");
  });

  it("levert opwek, maar verzint geen verbruik of netgegevens zonder meter", async () => {
    const { f } = fakeFetch(handler);
    const a = new SolarEdgeAdapter({ siteId: "123456", name: "Thuis", timeZone: "Europe/Amsterdam", peakPowerKw: 5.2 }, f);
    await a.connect(ctx({ apiKey: "KEY" }));
    const s = await a.energy.getSummary();
    expect(s).toMatchObject({ demo: false, currentProductionW: 1530, currentConsumptionW: null, gridImportW: null, gridExportW: null });
    expect(s.today).toEqual({ productionKwh: 4.25, consumptionKwh: null, importKwh: null, exportKwh: null });
    expect(s.updatedAt).toBe("2026-11-20T12:45:00.000Z");
    const st = await a.getStatus();
    expect(st).toMatchObject({ status: "ONLINE", state: { productionW: 1530, energyTodayKwh: 4.25 }, stateAt: "2026-11-20T12:45:00.000Z" });
    await a.disconnect();
  });

  it("haalt historie op met de juiste resolutie en cachet die (spaart de daglimiet)", async () => {
    const { f, calls } = fakeFetch(handler);
    const a = new SolarEdgeAdapter({ siteId: "1", name: "x", timeZone: "Europe/Amsterdam", peakPowerKw: null }, f, () => Date.parse("2026-11-20T15:00:00Z"));
    await a.connect(ctx({ apiKey: "KEY" }));
    const h = await a.energy.getHistory("day");
    expect(h.bucket).toBe("15m");
    expect(h.points[0]).toEqual({ t: "2026-11-20T09:00:00.000Z", productionKwh: 0.25, consumptionKwh: null, importKwh: null, exportKwh: null });
    expect(h.points[1]!.productionKwh).toBeNull();
    const n = calls.length;
    await a.energy.getHistory("day");
    expect(calls.length).toBe(n);
    await a.energy.getHistory("year");
    expect(calls.at(-1)!.url.searchParams.get("timeUnit")).toBe("MONTH");
    expect(calls.at(-1)!.url.searchParams.get("startDate")).toBe("2026-01-01");
    await a.disconnect();
  });

  it("weigert opdrachten en meldt een verkeerde key", async () => {
    const { f } = fakeFetch(() => ({ status: 403 }));
    const a = new SolarEdgeAdapter({ siteId: "1", name: "x", timeZone: "Europe/Amsterdam", peakPowerKw: null }, f);
    await a.connect(ctx({ apiKey: "KEY" }));
    expect((await a.getStatus()).status).toBe("ERROR");
    expect((await a.executeCommand("site", { type: "set_power", on: true })).ok).toBe(false);
    await a.disconnect();
  });
});

describe("Daikin Onecta", () => {
  const device = () => ({
    id: "dev-1",
    managementPoints: [
      { embeddedId: "gateway", managementPointType: "gateway", modelInfo: { value: "BRP069C4x" } },
      {
        embeddedId: "climateControl",
        managementPointType: "climateControl",
        name: { value: "Slaapkamer" },
        onOffMode: { value: "off", settable: true },
        operationMode: { value: "cooling", settable: true, values: ["auto", "cooling", "heating", "dry", "fanOnly"] },
        temperatureControl: {
          settable: true,
          value: { operationModes: { cooling: { setpoints: { roomTemperature: { value: 22, minValue: 18, maxValue: 32, stepValue: 0.5, settable: true } } }, heating: { setpoints: { roomTemperature: { value: 20, minValue: 10, maxValue: 30, stepValue: 0.5, settable: true } } } } },
        },
        sensoryData: { value: { roomTemperature: { value: 24.5 }, outdoorTemperature: { value: 9 } } },
      },
    ],
  });

  function setup(opts: { status?: number; headers?: Record<string, string>; tokenExpired?: boolean } = {}) {
    let state = device();
    const { f, calls } = fakeFetch((url, init) => {
      if (url.host === "idp.onecta.daikineurope.com") return { json: { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 } };
      if (init.method === "PATCH") return { status: opts.status ?? 204, headers: opts.headers };
      return { json: [state], headers: { "x-ratelimit-remaining-day": "180" } };
    });
    const secrets = { clientSecret: "secret", tokens: JSON.stringify({ accessToken: "acc", refreshToken: "ref", expiresAt: opts.tokenExpired ? 0 : Date.now() + 3_600_000 }) };
    const c = ctx(secrets);
    const a = new DaikinAdapter({ clientId: "client", redirectUri: "https://homeos.example/cb" }, f);
    return { a, c, calls, reset: () => (state = device()) };
  }

  it("valideert redirect-URI's en bouwt de autorisatie-URL", () => {
    expect(validateRedirectUri("http://homeos.example/cb")).toMatch(/https/);
    expect(validateRedirectUri("https://localhost/cb")).toMatch(/localhost/);
    expect(validateRedirectUri("https://192.168.1.10:8443/cb")).toBeNull();
    const u = new URL(authorizeUrl({ clientId: "c", redirectUri: "https://x.example/cb", state: "s1" }));
    expect(u.host).toBe("idp.onecta.daikineurope.com");
    expect(u.searchParams.get("scope")).toBe("openid onecta:basic.integration");
    expect(parseCallbackUrl("https://x.example/cb?code=abc&state=s1")).toEqual({ code: "abc", state: "s1" });
    expect(parseCallbackUrl("https://x.example/cb?error=access_denied")).toHaveProperty("error");
    expect(parseCallbackUrl("geen url")).toHaveProperty("error");
  });

  it("leest units met modus, setpoint en temperaturen", async () => {
    const { a, c } = setup();
    await a.connect(c);
    const [d] = await a.discover();
    expect(d).toMatchObject({ name: "Slaapkamer", brand: "Daikin", model: "BRP069C4x", kind: "climate", capabilities: ["onoff", "climate"] });
    const s = await a.getStatus("dev-1");
    expect(s.state).toMatchObject({ on: false, climate: { mode: "cooling", targetTempC: 22, minTempC: 18, maxTempC: 32, stepC: 0.5, roomTempC: 24.5, outdoorTempC: 9 } });
    expect(a.budget.remaining()).toBeLessThanOrEqual(180);
    await a.disconnect();
  });

  it("stuurt de officiële PATCH-opdrachten met het juiste pad", async () => {
    const { a, c, calls } = setup();
    await a.connect(c);
    expect((await a.executeCommand("dev-1", { type: "set_power", on: true })).ok).toBe(true);
    let last = calls.at(-1)!;
    expect(last.url.pathname).toBe("/v1/gateway-devices/dev-1/management-points/climateControl/characteristics/onOffMode");
    expect(JSON.parse(String(last.init.body))).toEqual({ value: "on" });
    const r = await a.executeCommand("dev-1", { type: "set_target_temperature", temperatureC: 21.5 });
    expect(r.ok && r.report.state.climate?.targetTempC).toBe(21.5);
    last = calls.at(-1)!;
    expect(last.url.pathname.endsWith("/characteristics/temperatureControl")).toBe(true);
    expect(JSON.parse(String(last.init.body))).toEqual({ value: 21.5, path: "/operationModes/cooling/setpoints/roomTemperature" });
    expect((await a.executeCommand("dev-1", { type: "set_target_temperature", temperatureC: 15 })).ok).toBe(false);
    await a.executeCommand("dev-1", { type: "set_hvac_mode", mode: "dry" });
    const noSetpoint = await a.executeCommand("dev-1", { type: "set_target_temperature", temperatureC: 22 });
    expect(!noSetpoint.ok && noSetpoint.message).toMatch(/deze modus/);
    await a.disconnect();
  });

  it("vernieuwt een verlopen token en bewaart de nieuwe tokens", async () => {
    const { a, c, calls } = setup({ tokenExpired: true });
    await a.connect(c);
    expect(calls[0]!.url.host).toBe("idp.onecta.daikineurope.com");
    const body = new URLSearchParams(String(calls[0]!.init.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(JSON.parse((await c.secrets.get("tokens"))!).refreshToken).toBe("new-refresh");
    await a.disconnect();
  });

  it("respecteert een 429 van Daikin", async () => {
    const { a, c } = setup({ status: 429, headers: { "retry-after": "600" } });
    await a.connect(c);
    const r = await a.executeCommand("dev-1", { type: "set_power", on: true });
    expect(!r.ok && r.message).toMatch(/10 minuten/);
    const again = await a.executeCommand("dev-1", { type: "set_power", on: true });
    expect(!again.ok && again.message).toMatch(/limiet/);
    await a.disconnect();
  });
});

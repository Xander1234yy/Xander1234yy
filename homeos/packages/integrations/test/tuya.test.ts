import { describe, expect, it } from "vitest";
import { tuyaSign, tuyaStringToSign } from "../src/tuya/client";
import { TuyaAdapter, validateTuya } from "../src/tuya/adapter";
import type { AdapterContext } from "../src";

function ctx(secret: string | null = "S3CRETs3cret1234"): AdapterContext {
  return {
    logger: { info() {}, warn() {}, error() {} },
    now: () => new Date(),
    emit: () => undefined,
    secrets: { get: async (k) => (k === "accessSecret" ? secret : null), set: async () => undefined, delete: async () => undefined },
  };
}

/** Nagebootste Tuya-cloud: controleert de handtekening echt, zoals de server dat doet. */
function fakeTuya(opts: { online?: boolean; quotaExceeded?: boolean } = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let on = false;
  const f = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const h = init.headers as Record<string, string>;
    const method = init.method ?? "GET";
    const query = Object.fromEntries(url.searchParams.entries());
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
    const expected = tuyaSign(h.client_id!, "S3CRETs3cret1234", h.t!, tuyaStringToSign(method, url.pathname, query, body), h.access_token ?? "");
    if (expected !== h.sign) return json({ success: false, code: 1004, msg: "sign invalid" });
    if (url.pathname === "/v1.0/token") return json({ success: true, result: { access_token: "AT", refresh_token: "RT", expire_time: 7200, uid: "owner" } });
    if (h.access_token !== "AT") return json({ success: false, code: 1010, msg: "token invalid" });
    if (opts.quotaExceeded) return json({ success: false, code: 28841004, msg: "quota exceeded" });
    if (url.pathname === "/v1.0/users/eu1234567/devices") {
      return json({
        success: true,
        result: [
          { id: "plug1", name: "Bureaustekker", category: "cz", product_name: "Smart Plug 16A", online: opts.online ?? true, status: [{ code: "switch_1", value: on }, { code: "cur_power", value: 523 }] },
          { id: "cam1", name: "Camera", category: "sp", online: true, status: [{ code: "basic_indicator", value: true }] },
        ],
      });
    }
    if (url.pathname === "/v1.0/devices/plug1/specifications") return json({ success: true, result: { status: [{ code: "cur_power", type: "Integer", values: '{"unit":"W","min":0,"max":50000,"scale":1,"step":1}' }] } });
    if (url.pathname === "/v1.0/devices/plug1/commands") {
      on = body.commands[0].value;
      return json({ success: true, result: true });
    }
    if (url.pathname === "/v1.0/devices/plug1/status") return json({ success: true, result: [{ code: "switch_1", value: on }, { code: "cur_power", value: on ? 523 : 0 }] });
    return json({ success: false, code: 1108, msg: "uri path invalid" });
  }) as typeof fetch;
  return { f, calls };
}

const config = { region: "eu" as const, accessId: "abcdefghij1234567890", uid: "eu1234567" };

describe("Tuya-ondertekening", () => {
  it("komt overeen met de referentie (berekend volgens Tuya's Python-SDK)", () => {
    const id = "abcd1234efgh5678ijkl";
    const sec = "s3cr3tS3cr3tS3cr3tS3cr3t1234";
    const t = "1700000000000";
    expect(tuyaSign(id, sec, t, tuyaStringToSign("GET", "/v1.0/token", { grant_type: 1 }))).toBe("C69330E584057C3F2A60EF4B5DC86A77CBE1BC3BFDA010141F195619DF3BEE80");
    expect(tuyaSign(id, sec, t, tuyaStringToSign("POST", "/v1.0/devices/dev1/commands", {}, { commands: [{ code: "switch_1", value: true }] }), "tok123")).toBe(
      "79A6EB2E7FE192F1FCA100989F0C754F3FCA8051FB4FE1D2C929398A0603FE0D",
    );
  });
});

describe("TuyaAdapter", () => {
  it("vindt alleen ondersteunde stekkers, met vermogen volgens de schaal uit de specificatie", async () => {
    const { f } = fakeTuya();
    const a = new TuyaAdapter(config, f);
    await a.connect(ctx());
    const found = await a.discover();
    expect(found).toEqual([expect.objectContaining({ externalId: "plug1", name: "Bureaustekker", brand: "Smart Life / Tuya", kind: "plug", capabilities: ["onoff", "power_metering"] })]);
    expect((await a.getStatus("plug1")).state).toEqual({ on: false, powerW: 52.3 });
    expect((await a.healthCheck()).message).toMatch(/1 ander/);
    await a.disconnect();
  });

  it("schakelt en leest de echte status terug", async () => {
    const { f, calls } = fakeTuya();
    const a = new TuyaAdapter(config, f);
    await a.connect(ctx());
    const r = await a.executeCommand("plug1", { type: "set_power", on: true });
    expect(r.ok && r.report.state.on).toBe(true);
    expect(calls.find((c) => c.path.endsWith("/commands"))?.body).toEqual({ commands: [{ code: "switch_1", value: true }] });
    expect(calls.at(-1)!.path).toBe("/v1.0/devices/plug1/status");
    expect((await a.executeCommand("plug1", { type: "set_brightness", brightness: 50 })).ok).toBe(false);
    await a.disconnect();
  });

  it("meldt offline stekkers en een verkeerde secret eerlijk", async () => {
    const { f } = fakeTuya({ online: false });
    const a = new TuyaAdapter(config, f);
    await a.connect(ctx());
    expect((await a.getStatus("plug1")).status).toBe("OFFLINE");
    expect((await a.executeCommand("plug1", { type: "set_power", on: true })).ok).toBe(false);
    await a.disconnect();
    const bad = new TuyaAdapter(config, fakeTuya().f);
    await bad.connect(ctx("VERKEERDsecret12"));
    expect((await bad.healthCheck()).status).toBe("down");
    expect((await bad.healthCheck()).message).toMatch(/handtekening/);
  });

  it("geeft een duidelijke melding als het quotum op is", async () => {
    const a = new TuyaAdapter(config, fakeTuya({ quotaExceeded: true }).f);
    await a.connect(ctx());
    expect((await a.healthCheck()).message).toMatch(/quotum/);
  });

  it("valideert gegevens bij het koppelen", async () => {
    await expect(validateTuya({ ...config, accessId: "kort" }, "S3CRETs3cret1234", fakeTuya().f)).rejects.toThrow(/Access ID/);
    expect(await validateTuya(config, "S3CRETs3cret1234", fakeTuya().f)).toBe(2);
  });
});

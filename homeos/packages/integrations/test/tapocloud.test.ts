import { describe, expect, it } from "vitest";
import { TapoCloudAdapter, TapoCloudClient, isTplinkHost, parseNotification, signature } from "../src/tapocloud/index";
import type { AdapterContext, AdapterEvent } from "../src/adapter";
import { fakeTapoCloud } from "./fake-tapocloud";

const logger = { info() {}, warn() {}, error() {} };
function ctxWith(secrets: Record<string, string>, cache: { v: unknown } = { v: null }, events: AdapterEvent[] = []): AdapterContext {
  return {
    logger,
    now: () => new Date(),
    emit: (e) => void events.push(e),
    serverless: true,
    secrets: { get: async (k) => secrets[k] ?? null, set: async (k, v) => void (secrets[k] = v), delete: async (k) => void delete secrets[k] },
    cache: { load: async () => cache.v, save: async (v) => void (cache.v = JSON.parse(JSON.stringify(v))) },
  };
}

describe("TP-Link-cloud (niet-officieel): client", () => {
  it("ondertekent aanvragen identiek aan de Python-referentie (tplink-cloud-api signing.py)", () => {
    const s = signature('{"a":1}', "/api/v2/account/login", "00000000-0000-4000-8000-000000000000");
    // Verwachte waarden onafhankelijk berekend met de community-implementatie in Python.
    expect(s.md5).toBe("u2y1xo30ZSlByvZSo2by2A==");
    expect(s.authorization).toBe("Timestamp=9999999999, Nonce=00000000-0000-4000-8000-000000000000, AccessKey=4d11b6b9d5ea4d19a829adbb9714b057, Signature=f54df62904144249135cfbe675f823a733ba38dc");
  });

  it("logt in, haalt camera's op (alias base64, rare ID's genegeerd) en gebruikt de regioserver", async () => {
    const f = fakeTapoCloud();
    const c = new TapoCloudClient("term-1", f.http);
    const r = await c.login(f.user, f.password);
    expect(r).toMatchObject({ kind: "ok", base: "https://n-euw1-wap.i.tplinkcloud.com", token: "tok-1", refreshToken: "ref-1" });
    if (r.kind !== "ok") return;
    expect(await c.cameras(r.base, r.token)).toEqual([
      { deviceId: f.CAM, name: "Tuin C500", model: "C500", type: "camera" },
      { deviceId: f.BELL, name: "Voordeur", model: "D230", type: "doorbell" },
    ]);
    expect(f.state.badSignatures).toBe(0);
    await expect(c.login(f.user, "fout")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("verificatiecode (MFA): stuurt de code via de Tapo-app en rondt af met checkMFACodeAndLogin", async () => {
    const f = fakeTapoCloud({ mfa: true });
    const c = new TapoCloudClient("term-1", f.http);
    const r = await c.login(f.user, f.password);
    expect(r).toMatchObject({ kind: "mfa", processId: "proc-1", mfaType: 1 });
    expect(f.state.mfaSent).toBe(1);
    if (r.kind !== "mfa") return;
    await expect(c.completeMfa(r.base, f.user, r.processId, r.mfaType, "000000")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await c.completeMfa(r.base, f.user, r.processId, r.mfaType, "123456")).toMatchObject({ token: "tok-1" });
  });

  it("alleen TP-Link-hosts en meldingen ontleden (object of JSON-tekst, seconden of milliseconden)", () => {
    expect(isTplinkHost("n-euw1-wap.i.tplinkcloud.com")).toBe(true);
    expect(isTplinkHost("euw1-app-server.iot.i.tplinknbu.com")).toBe(true);
    expect(isTplinkHost("tplinkcloud.com.evil.example")).toBe(false);
    expect(parseNotification({ time: 1795290000, msgType: "PersonDetected", title: "Persoon", attachments: JSON.stringify({ deviceId: "ABCDEF12" }) })).toEqual([
      { deviceId: "ABCDEF12", at: new Date(1795290000_000).toISOString(), kind: "person", title: "Persoon" },
    ]);
    expect(parseNotification({ time: 1795290000123, msgType: "ringEvent", attachments: { deviceId: "ABCDEF12" } })[0]!.kind).toBe("ring");
    expect(parseNotification({ msgType: "Motion" })).toEqual([]);
  });
});

describe("TapoCloudAdapter", () => {
  async function setup(f = fakeTapoCloud()) {
    const c = new TapoCloudClient("term-1", f.http);
    const r = await c.login(f.user, f.password);
    if (r.kind !== "ok") throw new Error("mfa");
    const secrets: Record<string, string> = { terminalUUID: "term-1", credentials: JSON.stringify({ email: f.user, password: f.password }), session: JSON.stringify({ base: r.base, token: r.token, refreshToken: r.refreshToken }) };
    const cameras = await c.cameras(r.base, r.token);
    return { f, secrets, cameras };
  }

  it("meldt nieuwe beweging/persoon/aanbellen als gebeurtenis, maar niet de oude meldingen van vóór het koppelen", async () => {
    const { f, secrets, cameras } = await setup();
    const now = Date.now();
    f.state.notifications.push({ time: now - 30 * 60_000, msgType: "Motion", attachments: { deviceId: f.CAM } }); // oud
    const cache = { v: null as unknown };
    const events: AdapterEvent[] = [];
    const a = new TapoCloudAdapter({ cameras }, f.http);
    await a.connect(ctxWith(secrets, cache, events));
    expect(events.filter((e) => e.type === "device_event")).toHaveLength(0);
    expect((await a.getStatus(f.CAM)).state.lastMotionAt).toBe(new Date(now - 30 * 60_000).toISOString());

    // Volgende aanvraag (serverless, na een minuut): nieuwe meldingen worden gebeurtenissen.
    f.state.notifications.push({ time: now + 1000, msgType: "PersonDetected", attachments: JSON.stringify({ deviceId: f.CAM }) });
    f.state.notifications.push({ time: now + 2000, msgType: "ringEvent", attachments: { deviceId: f.BELL } });
    const later = () => now + 61_000;
    const b = new TapoCloudAdapter({ cameras }, f.http, later);
    const ev2: AdapterEvent[] = [];
    await b.connect(ctxWith(secrets, cache, ev2));
    const dev = ev2.flatMap((e) => (e.type === "device_event" ? [{ id: e.externalId, type: e.event.type, msg: e.event.message }] : []));
    expect(dev).toEqual([
      { id: f.CAM, type: "motion", msg: "Persoon gezien bij Tuin C500" },
      { id: f.BELL, type: "doorbell_ring", msg: "Er wordt aangebeld (Voordeur)" },
    ]);
    expect((await b.getStatus(f.BELL)).state.lastRingAt).toBe(new Date(now + 2000).toISOString());
  });

  it("camera aan/uit = privacymodus, met teruglezen; draaien geweigerd zolang de privacymodus aan staat", async () => {
    const { f, secrets, cameras } = await setup();
    const a = new TapoCloudAdapter({ cameras }, f.http);
    await a.connect(ctxWith(secrets));
    const off = await a.executeCommand(f.CAM, { type: "set_power", on: false });
    expect(off.ok).toBe(true);
    if (off.ok) expect(off.report.state.on).toBe(false);
    expect(f.state.privacy).toBe("on");
    expect(await a.executeCommand(f.CAM, { type: "ptz_move", direction: "left" })).toMatchObject({ ok: false, message: "De privacymodus staat aan" });
    await a.executeCommand(f.CAM, { type: "set_power", on: true });
    expect(f.state.privacy).toBe("off");
    expect((await a.executeCommand(f.CAM, { type: "ptz_move", direction: "up" })).ok).toBe(true);
    expect(f.state.moves).toEqual([{ x: "0", y: "10" }]);
    expect(await a.executeCommand(f.BELL, { type: "set_power", on: false })).toMatchObject({ ok: false, code: "UNSUPPORTED" });
  });

  it("vernieuwt een verlopen token automatisch (account-API én camera-opdrachten)", async () => {
    const { f, secrets, cameras } = await setup();
    const a = new TapoCloudAdapter({ cameras }, f.http);
    await a.connect(ctxWith(secrets));
    f.state.expire = true;
    const r = await a.executeCommand(f.CAM, { type: "ptz_move", direction: "right" });
    expect(r.ok).toBe(true);
    expect(f.state.refreshes).toBe(1);
    expect(JSON.parse(secrets.session!).token).toBe("tok-r1");
    expect(f.state.badSignatures).toBe(0);
  });
});

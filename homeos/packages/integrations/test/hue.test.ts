import https from "node:https";
import { afterEach, describe, expect, it } from "vitest";
import selfsigned from "selfsigned";
import { createHueHttp, fetchPeerCertificate, CertificateMismatchError, isPrivateLanHost } from "../src/hue/net";
import { hexToXy, xyToHex, kelvinToMirek } from "../src/hue/color";
import { pairBridge } from "../src/hue/pairing";
import { HueAdapter } from "../src/hue/adapter";
import type { AdapterContext, AdapterEvent } from "../src";
import { fakeBridge } from "./fake-bridge";

function ctx(events: AdapterEvent[] = [], key: string | null = "app-key"): AdapterContext {
  return {
    logger: { info() {}, warn() {}, error() {} },
    now: () => new Date(),
    emit: (e) => events.push(e),
    secrets: { get: async () => key, set: async () => undefined, delete: async () => undefined },
  };
}
const config = { bridgeId: "001788fffe123456", host: "192.168.1.20", name: "Bridge", fingerprint256: "AA" };

describe("Hue kleurconversie", () => {
  it("zet hex om naar xy binnen het gamut en terug", () => {
    const red = hexToXy("#ff0000");
    expect(red.x).toBeGreaterThan(0.6);
    expect(red.y).toBeLessThan(0.35);
    const white = hexToXy("#ffffff");
    expect(white.x).toBeCloseTo(0.3227, 1);
    expect(xyToHex(red)).toMatch(/^#ff[0-4][0-9a-f][0-4][0-9a-f]$/);
    expect(kelvinToMirek(2700)).toBe(370);
  });
});

describe("Hue netwerk-beveiliging", () => {
  let server: https.Server | null = null;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  it("staat alleen privé-LAN-adressen toe", () => {
    expect(isPrivateLanHost("192.168.1.20")).toBe(true);
    expect(isPrivateLanHost("10.0.0.5")).toBe(true);
    expect(isPrivateLanHost("172.20.1.1")).toBe(true);
    expect(isPrivateLanHost("8.8.8.8")).toBe(false);
    expect(isPrivateLanHost("127.0.0.1")).toBe(false);
    expect(isPrivateLanHost("bridge.example.com")).toBe(false);
    expect(isPrivateLanHost("192.168.1.300")).toBe(false);
    expect(isPrivateLanHost("169.254.12.7")).toBe(true);
    expect(isPrivateLanHost("169.254.169.254")).toBe(false); // metadata-adres van cloudservers
    expect(isPrivateLanHost("169.254.170.2")).toBe(false);
    expect(isPrivateLanHost("192.168.1.255")).toBe(false);
    expect(isPrivateLanHost("172.32.0.1")).toBe(false);
    expect(isPrivateLanHost("::1")).toBe(false);
  });

  it("pint het certificaat: verkeerde vingerafdruk → geen verzoek en geen key verstuurd", async () => {
    const pems = await selfsigned.generate([{ name: "commonName", value: "001788fffe123456" }], { keySize: 2048 });
    let received: string[] = [];
    server = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
      received.push(String(req.headers["hue-application-key"]));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ errors: [], data: [] }));
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;

    const peer = await fetchPeerCertificate("127.0.0.1", port);
    expect(peer.commonName).toBe("001788fffe123456");

    const good = createHueHttp({ host: "127.0.0.1", port, fingerprint256: peer.fingerprint256, appKey: "geheim" });
    expect((await good.request("GET", "/clip/v2/resource/light")).status).toBe(200);
    expect(received).toEqual(["geheim"]);

    received = [];
    const bad = createHueHttp({ host: "127.0.0.1", port, fingerprint256: "00:11:22", appKey: "geheim" });
    await expect(bad.request("GET", "/clip/v2/resource/light")).rejects.toBeInstanceOf(CertificateMismatchError);
    expect(received).toEqual([]);
  }, 30_000);
});

describe("Hue koppelen", () => {
  const peer = async () => ({ fingerprint256: "FP", commonName: "001788fffe123456" });
  const bridgeHttp = (pressed: boolean, cfg: Record<string, string> = { bridgeid: "001788FFFE123456", modelid: "BSB002", name: "Hue" }) => () => ({
    async request<T>(method: string, path: string) {
      if (path === "/api/0/config") return { status: 200, body: cfg as T };
      if (method === "POST" && path === "/api") {
        return { status: 200, body: (pressed ? [{ success: { username: "key-123", clientkey: "ck" } }] : [{ error: { type: 101, description: "link button not pressed" } }]) as T };
      }
      return { status: 404, body: null as T };
    },
    stream: async () => undefined,
  });

  it("vraagt om de link-knop en koppelt daarna", async () => {
    expect(await pairBridge("192.168.1.20", { peer, http: bridgeHttp(false) })).toMatchObject({ ok: false, code: "LINK_BUTTON_NOT_PRESSED" });
    expect(await pairBridge("192.168.1.20", { peer, http: bridgeHttp(true) })).toMatchObject({ ok: true, appKey: "key-123", fingerprint256: "FP", bridge: { bridgeId: "001788fffe123456" } });
  });

  it("weigert publieke adressen, andere apparaten en certificaat-mismatch", async () => {
    expect(await pairBridge("8.8.8.8", { peer, http: bridgeHttp(true) })).toMatchObject({ ok: false, code: "INVALID_HOST" });
    expect(await pairBridge("192.168.1.20", { peer, http: bridgeHttp(true, { name: "router" }) })).toMatchObject({ ok: false, code: "NOT_A_HUE_BRIDGE" });
    expect(await pairBridge("192.168.1.20", { peer: async () => ({ fingerprint256: "FP", commonName: "iets-anders" }), http: bridgeHttp(true) })).toMatchObject({ ok: false, code: "CERT_MISMATCH" });
    expect(await pairBridge("192.168.1.20", { peer: async () => Promise.reject(new Error("x")), http: bridgeHttp(true) })).toMatchObject({ ok: false, code: "UNREACHABLE" });
  });
});

describe("HueAdapter", () => {
  async function setup() {
    const b = fakeBridge();
    const events: AdapterEvent[] = [];
    const a = new HueAdapter(config, () => b.http);
    await a.connect(ctx(events));
    return { a, b, events };
  }

  it("vindt lampen met juiste capabilities, merk en kamer", async () => {
    const { a } = await setup();
    const found = await a.discover();
    expect(found.find((d) => d.externalId === "l-1")).toMatchObject({
      name: "Plafond",
      brand: "Philips Hue",
      model: "Hue color lamp",
      capabilities: ["onoff", "brightness", "color", "color_temperature"],
      suggestedRoomId: "woonkamer",
    });
    expect(a.getCapabilities("l-2")).toEqual(["onoff"]);
    expect(a.demo).toBe(false);
    await a.disconnect();
  });

  it("vertaalt opdrachten naar CLIP v2 en leest de echte status terug", async () => {
    const { a, b } = await setup();
    const r = await a.executeCommand("l-1", { type: "set_brightness", brightness: 80 });
    expect(b.puts.at(-1)).toEqual({ path: "/clip/v2/resource/light/l-1", body: { on: { on: true }, dimming: { brightness: 80 } } });
    expect(r.ok && r.report.state).toMatchObject({ on: true, brightness: 80 });
    await a.executeCommand("l-1", { type: "set_color_temperature", colorTempK: 6500 });
    expect((b.puts.at(-1)!.body as { color_temperature: { mirek: number } }).color_temperature.mirek).toBe(154);
    await a.executeCommand("l-1", { type: "set_color", colorHex: "#ff0000" });
    expect((b.puts.at(-1)!.body as { color: { xy: { x: number } } }).color.xy.x).toBeGreaterThan(0.6);
    await a.disconnect();
  });

  it("toont onbereikbare lampen als OFFLINE en weigert opdrachten", async () => {
    const { a, b } = await setup();
    expect((await a.getStatus("l-2")).status).toBe("OFFLINE");
    const r = await a.executeCommand("l-2", { type: "set_power", on: false });
    expect(!r.ok && r.code).toBe("DEVICE_UNAVAILABLE");
    expect(b.puts).toEqual([]);
    const unsupported = await a.executeCommand("l-1", { type: "media", action: "play" });
    expect(!unsupported.ok && unsupported.code).toBe("UNSUPPORTED");
    await a.disconnect();
  });

  it("verwerkt eventstream-updates", async () => {
    const { a, events } = await setup();
    a.onEvent(JSON.stringify([{ type: "update", data: [{ id: "l-1", type: "light", on: { on: true }, dimming: { brightness: 12 } }] }]));
    expect((await a.getStatus("l-1")).state).toMatchObject({ on: true, brightness: 12 });
    a.onEvent(JSON.stringify([{ type: "update", data: [{ id: "z-2", type: "zigbee_connectivity", owner: { rid: "d-2" }, status: "connected" }] }]));
    expect((await a.getStatus("l-2")).status).toBe("ONLINE");
    a.onEvent("geen json");
    expect(events.some((e) => e.type === "device_state")).toBe(true);
    await a.disconnect();
  });

  it("activeert scènes met kamernaam", async () => {
    const { a, b } = await setup();
    expect(await a.getScenes()).toEqual([{ id: "s-1", name: "Ontspannen · Woonkamer", roomId: "woonkamer" }]);
    expect(await a.activateScene("s-1")).toEqual({ ok: true });
    expect(b.puts.at(-1)).toEqual({ path: "/clip/v2/resource/scene/s-1", body: { recall: { action: "active" } } });
    expect((await a.activateScene("bestaat-niet")).ok).toBe(false);
    await a.disconnect();
  });

  it("meldt een geweigerde key als fout in plaats van oude status als live", async () => {
    const { a, b } = await setup();
    b.fail(403);
    await a.refresh();
    const s = await a.getStatus("l-1");
    expect(s.status).toBe("ERROR");
    expect(s.error).toMatch(/opnieuw/);
    expect((await a.healthCheck()).status).toBe("down");
    await a.disconnect();
  });

  it("zonder application key: niet geconfigureerd", async () => {
    const a = new HueAdapter(config, () => fakeBridge().http);
    await a.connect(ctx([], null));
    expect((await a.healthCheck()).status).toBe("not_configured");
    expect(await a.discover()).toEqual([]);
  });
});

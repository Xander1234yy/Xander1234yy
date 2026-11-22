import { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ZiggoAdapter, ZiggoApi, connectPacket, isZiggoHost, parsePublish, publishPacket, splitPackets, subscribePacket, wsMqttConnect } from "../src/ziggo/index";
import type { AdapterContext } from "../src/adapter";
import { fakeZiggo } from "./fake-ziggo";

const logger = { info() {}, warn() {}, error() {} };
function ctxWith(secrets: Record<string, string>, cache: { v: unknown } = { v: null }): AdapterContext {
  return {
    logger,
    now: () => new Date(),
    emit() {},
    serverless: true,
    secrets: { get: async (k) => secrets[k] ?? null, set: async (k, v) => void (secrets[k] = v), delete: async (k) => void delete secrets[k] },
    cache: { load: async () => cache.v, save: async (v) => void (cache.v = JSON.parse(JSON.stringify(v))) },
  };
}

describe("Ziggo (niet-officieel): MQTT-pakketten", () => {
  it("bouwt CONNECT/SUBSCRIBE/PUBLISH en leest ze terug, ook gesplitst over meerdere WebSocket-berichten", () => {
    const all = Buffer.concat([connectPacket("c1", "HH", "tok"), subscribePacket(1, "HH/box/status"), publishPacket("HH/box", "x".repeat(300))]);
    const first = splitPackets(all.subarray(0, 40));
    const second = splitPackets(Buffer.concat([first.rest, all.subarray(40)]));
    const types = [...first.packets, ...second.packets].map((p) => p.type);
    expect(types).toEqual([1, 8, 3]);
    const pub = parsePublish(second.packets.at(-1)!);
    expect(pub).toMatchObject({ topic: "HH/box", qos: 0 });
    expect(pub.payload).toHaveLength(300);
    const c = [...first.packets, ...second.packets][0]!;
    expect(c.body.subarray(0, 6).toString("latin1")).toBe("\u0000\u0004MQTT");
    expect(c.body[6]).toBe(4); // MQTT 3.1.1
    expect(c.body[7]).toBe(0xc2); // gebruikersnaam + wachtwoord + clean session
  });

  it("alleen Ziggo-hosts", () => {
    expect(isZiggoHost("spark-prod-nl.gnp.cloud.ziggogo.tv")).toBe(true);
    expect(isZiggoHost("obomsg.prod.nl.horizon.tv")).toBe(true);
    expect(isZiggoHost("ziggogo.tv.evil.example")).toBe(false);
    expect(isZiggoHost("evilziggogo.tv")).toBe(false);
  });
});

describe("Ziggo: echte WebSocket-MQTT tegen een lokale testserver", () => {
  let wss: WebSocketServer | null = null;
  afterEach(() => new Promise<void>((r) => (wss ? wss.close(() => r()) : r())));

  it("verbindt met token, abonneert, publiceert en ontvangt", async () => {
    const seen: { protocol?: string; user?: string; pass?: string; pubs: string[] } = { pubs: [] };
    wss = new WebSocketServer({ port: 0, handleProtocols: (p) => (p.has("mqtt") ? "mqtt" : false) });
    wss.on("connection", (ws) => {
      seen.protocol = ws.protocol;
      let buf = Buffer.alloc(0);
      ws.on("message", (d: Buffer) => {
        const r = splitPackets(Buffer.concat([buf, d]));
        buf = Buffer.from(r.rest);
        for (const p of r.packets) {
          if (p.type === 1) {
            let o = 10;
            const read = () => {
              const n = p.body.readUInt16BE(o);
              const s = p.body.subarray(o + 2, o + 2 + n).toString();
              o += 2 + n;
              return s;
            };
            read(); // client-id
            seen.user = read();
            seen.pass = read();
            ws.send(Buffer.from([0x20, 2, 0, seen.pass === "tok" ? 0 : 5]));
          } else if (p.type === 8) {
            ws.send(Buffer.from([0x90, 3, p.body[0]!, p.body[1]!, 0]));
            ws.send(publishPacket("HH/box/status", JSON.stringify({ state: "ONLINE_RUNNING" })));
          } else if (p.type === 3) seen.pubs.push(parsePublish(p).payload);
        }
      });
    });
    const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/mqtt`;
    const s = await wsMqttConnect({ url, clientId: "c1", username: "HH", password: "tok", timeoutMs: 3000 });
    const got: string[] = [];
    s.onMessage((t, p) => got.push(`${t} ${p}`));
    await s.subscribe("HH/box/status");
    s.publish("HH/box", { type: "CPE.KeyEvent" });
    await new Promise((r) => setTimeout(r, 100));
    await s.end();
    expect(seen).toMatchObject({ protocol: "mqtt", user: "HH", pass: "tok", pubs: ['{"type":"CPE.KeyEvent"}'] });
    expect(got).toEqual(['HH/box/status {"state":"ONLINE_RUNNING"}']);
    await expect(wsMqttConnect({ url, clientId: "c2", username: "HH", password: "fout", timeoutMs: 3000 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("ZiggoAdapter", () => {
  const box = { deviceId: "3C36E4-EOSSTB-003656789", name: "Ziggo woonkamer", platform: "EOS2" };

  async function setup(startState = "ONLINE_STANDBY") {
    const z = fakeZiggo({ startState });
    const api = new ZiggoApi(z.fetchImpl);
    const s = await api.services();
    const session = await api.login(s, z.user, z.password);
    const secrets: Record<string, string> = { credentials: JSON.stringify({ username: z.user, password: z.password }), session: JSON.stringify(session) };
    const cache = { v: null as unknown };
    const a = new ZiggoAdapter({ boxes: [box], cityId: "65535" }, z.fetchImpl, z.mqttConnect);
    await a.connect(ctxWith(secrets, cache));
    return { z, a, secrets, cache };
  }

  it("leest status en zender, zet aan via Power en controleert de nieuwe status", async () => {
    const { z, a } = await setup("ONLINE_STANDBY");
    const st = await a.getStatus(box.deviceId);
    expect(st.status).toBe("ONLINE");
    expect(st.state.media?.power).toBe("standby");
    expect(st.state.media?.title).toBe("1. NPO 1");
    expect(st.state.media?.sources?.map((s) => s.label)).toEqual(["1. NPO 1", "2. NPO 2", "4. RTL 4"]);
    expect(z.state.connects[0]).toMatchObject({ url: "wss://obomsg.prod.nl.horizon.tv:443/mqtt", username: "HH123", password: "mqtt-token-1" });

    const r = await a.executeCommand(box.deviceId, { type: "media_power", on: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.report.state.media?.power).toBe("on");
    const keys = z.state.published.filter((p) => p.payload.type === "CPE.KeyEvent");
    expect(keys).toHaveLength(1);
    expect(keys[0]!.payload.status).toEqual({ w3cKey: "Power", eventType: "keyDownUp" });

    // Al aan: geen tweede Power (die zou hem juist uitzetten).
    await a.executeCommand(box.deviceId, { type: "media_power", on: true });
    expect(z.state.published.filter((p) => p.payload.type === "CPE.KeyEvent")).toHaveLength(1);
  });

  it("kiest een zender met CPE.pushToTV en weigert onbekende zenders", async () => {
    const { z, a } = await setup("ONLINE_RUNNING");
    const r = await a.executeCommand(box.deviceId, { type: "select_source", sourceId: "NL_000004_019404" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.report.state.media?.title).toBe("4. RTL 4");
    const push = z.state.published.find((p) => p.payload.type === "CPE.pushToTV")!;
    expect(push.topic).toBe(`HH123/${box.deviceId}`);
    expect(push.payload.status).toEqual({ sourceType: "linear", source: { channelId: "NL_000004_019404" }, relativePosition: 0, speed: 1 });
    expect(await a.executeCommand(box.deviceId, { type: "select_source", sourceId: "NL_999" })).toMatchObject({ ok: false, code: "UNSUPPORTED" });
  });

  it("afstandsbedieningsknoppen en afspelen/pauzeren als Ziggo-toetsen", async () => {
    const { z, a } = await setup("ONLINE_RUNNING");
    await a.executeCommand(box.deviceId, { type: "remote_button", button: "CHANNELUP" });
    await a.executeCommand(box.deviceId, { type: "remote_button", button: "7" });
    await a.executeCommand(box.deviceId, { type: "media", action: "pause" });
    const keys = z.state.published.filter((p) => p.payload.type === "CPE.KeyEvent").map((p) => (p.payload.status as { w3cKey: string }).w3cKey);
    expect(keys).toEqual(["ChannelUp", "7", "MediaPlayPause"]);
    expect(await a.executeCommand(box.deviceId, { type: "set_volume", volume: 10 })).toMatchObject({ ok: false, code: "UNSUPPORTED" });
  });

  it("vernieuwt een verlopen sessie automatisch en bewaart status tussen aanvragen", async () => {
    const { z, a, secrets, cache } = await setup("ONLINE_RUNNING");
    z.state.expireToken = true;
    const r = await a.executeCommand(box.deviceId, { type: "remote_button", button: "OK" as never });
    expect(r).toMatchObject({ ok: false, code: "UNSUPPORTED" }); // onbekende knop: niet versturen
    const ok = await a.executeCommand(box.deviceId, { type: "remote_button", button: "ENTER" });
    expect(ok.ok).toBe(true);
    expect(z.state.refreshes).toBe(1);
    expect(JSON.parse(secrets.session!).accessToken).toBe("acc-r1");
    await a.getStatus(box.deviceId); // haalt status op (nog nooit gedaan)
    // Nieuwe aanvraag (serverless): status en zenders uit de opslag, zonder nieuwe verbinding.
    const b = new ZiggoAdapter({ boxes: [box], cityId: "65535" }, z.fetchImpl, z.mqttConnect);
    await b.connect(ctxWith(secrets, cache));
    const before = z.state.connects.length;
    const st = await b.getStatus(box.deviceId);
    expect(st.state.media?.power).toBe("on");
    expect(z.state.connects.length).toBe(before);
    expect(JSON.stringify(cache.v)).not.toContain("geheim-wachtwoord");
  });
});

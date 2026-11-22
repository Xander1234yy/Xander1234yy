/**
 * Minimale MQTT 3.1.1-client over WebSocket (alleen wat de Ziggo-box nodig heeft): verbinden met gebruikersnaam en
 * token, abonneren (QoS 0), publiceren (QoS 0) en berichten ontvangen. Korte sessies: verbinden → opdracht → klaar,
 * zodat het ook in de cloudmodus (serverless) werkt. Geen herverbinden of keep-alive nodig.
 */
import WebSocket from "ws";

// ---------- pakketten ----------

function varLen(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}
function str(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  const h = Buffer.alloc(2);
  h.writeUInt16BE(b.length);
  return Buffer.concat([h, b]);
}
function packet(type: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([type, ...varLen(body.length)]), body]);
}

export function connectPacket(clientId: string, username: string, password: string, keepAlive = 60): Buffer {
  const head = Buffer.concat([str("MQTT"), Buffer.from([4, 0xc2, keepAlive >> 8, keepAlive & 0xff])]);
  return packet(0x10, Buffer.concat([head, str(clientId), str(username), str(password)]));
}
export function subscribePacket(packetId: number, topic: string): Buffer {
  return packet(0x82, Buffer.concat([Buffer.from([packetId >> 8, packetId & 0xff]), str(topic), Buffer.from([0])]));
}
export function publishPacket(topic: string, payload: string, retain = false): Buffer {
  return packet(0x30 | (retain ? 1 : 0), Buffer.concat([str(topic), Buffer.from(payload, "utf8")]));
}
export const DISCONNECT = Buffer.from([0xe0, 0]);

export interface MqttPacket {
  type: number;
  flags: number;
  body: Buffer;
}
/** Splitst een stroom bytes in MQTT-pakketten; geeft de rest terug die nog niet compleet is. */
export function splitPackets(buf: Buffer): { packets: MqttPacket[]; rest: Buffer } {
  const packets: MqttPacket[] = [];
  let pos = 0;
  while (pos + 2 <= buf.length) {
    let len = 0;
    let mul = 1;
    let i = pos + 1;
    let complete = false;
    for (let n = 0; n < 4 && i < buf.length; n++, i++) {
      len += (buf[i]! & 0x7f) * mul;
      mul *= 128;
      if (!(buf[i]! & 0x80)) {
        complete = true;
        i++;
        break;
      }
    }
    if (!complete || i + len > buf.length) break;
    packets.push({ type: buf[pos]! >> 4, flags: buf[pos]! & 0x0f, body: buf.subarray(i, i + len) });
    pos = i + len;
  }
  return { packets, rest: buf.subarray(pos) };
}
/** PUBLISH ontleden: onderwerp, eventueel pakket-ID (QoS 1/2) en inhoud. */
export function parsePublish(p: MqttPacket): { topic: string; payload: string; qos: number; packetId: number | null } {
  const tl = p.body.readUInt16BE(0);
  const topic = p.body.subarray(2, 2 + tl).toString("utf8");
  const qos = (p.flags >> 1) & 3;
  let off = 2 + tl;
  let packetId: number | null = null;
  if (qos > 0) {
    packetId = p.body.readUInt16BE(off);
    off += 2;
  }
  return { topic, payload: p.body.subarray(off).toString("utf8"), qos, packetId };
}

// ---------- verbinding ----------

export interface MqttSession {
  subscribe(topic: string): Promise<void>;
  publish(topic: string, payload: unknown, retain?: boolean): void;
  onMessage(cb: (topic: string, payload: string) => void): void;
  end(): Promise<void>;
}
export type MqttConnect = (o: { url: string; clientId: string; username: string; password: string; timeoutMs?: number }) => Promise<MqttSession>;

export class ZiggoMqttError extends Error {
  constructor(
    message: string,
    readonly code: "UNAUTHORIZED" | "UNAVAILABLE" | "FAILED",
  ) {
    super(message);
  }
}

/** Echte verbinding via wss:// (alleen naar hosts die de aanroeper heeft gecontroleerd). */
export const wsMqttConnect: MqttConnect = ({ url, clientId, username, password, timeoutMs = 10_000 }) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, ["mqtt", "mqttv3.1", "mqttv3.11"], { handshakeTimeout: timeoutMs });
    let buf = Buffer.alloc(0);
    let nextId = 1;
    let connected = false;
    const listeners: ((t: string, p: string) => void)[] = [];
    const subacks = new Map<number, () => void>();
    const timer = setTimeout(() => fail(new ZiggoMqttError("Ziggo reageert niet (time-out)", "UNAVAILABLE")), timeoutMs);
    const fail = (e: Error) => {
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        /* al dicht */
      }
      if (!connected) reject(e);
    };
    ws.on("error", (e) => fail(new ZiggoMqttError(`Ziggo niet bereikbaar: ${e.message}`, "UNAVAILABLE")));
    ws.on("unexpected-response", (_req, res) => fail(new ZiggoMqttError(`Ziggo weigert de verbinding (${res.statusCode})`, res.statusCode === 401 || res.statusCode === 403 ? "UNAUTHORIZED" : "UNAVAILABLE")));
    ws.on("open", () => ws.send(connectPacket(clientId, username, password)));
    ws.on("message", (data: Buffer) => {
      const r = splitPackets(Buffer.concat([buf, data]));
      buf = Buffer.from(r.rest);
      for (const p of r.packets) {
        if (p.type === 2) {
          const rc = p.body[1];
          if (rc !== 0) return fail(new ZiggoMqttError(rc === 4 || rc === 5 ? "Ziggo weigert de aanmelding (opnieuw koppelen?)" : `Ziggo weigert de verbinding (code ${rc})`, rc === 4 || rc === 5 ? "UNAUTHORIZED" : "FAILED"));
          connected = true;
          clearTimeout(timer);
          resolve(session);
        } else if (p.type === 9) {
          subacks.get(p.body.readUInt16BE(0))?.();
        } else if (p.type === 3) {
          const m = parsePublish(p);
          if (m.qos === 1 && m.packetId !== null) ws.send(Buffer.from([0x40, 2, m.packetId >> 8, m.packetId & 0xff]));
          for (const l of listeners) l(m.topic, m.payload);
        }
      }
    });
    const session: MqttSession = {
      subscribe: (topic) =>
        new Promise((res) => {
          const id = nextId++;
          subacks.set(id, () => res());
          ws.send(subscribePacket(id, topic));
          setTimeout(res, 3000); // geen SUBACK: toch doorgaan
        }),
      publish: (topic, payload, retain = false) => ws.send(publishPacket(topic, typeof payload === "string" ? payload : JSON.stringify(payload), retain)),
      onMessage: (cb) => void listeners.push(cb),
      end: () =>
        new Promise((res) => {
          try {
            ws.send(DISCONNECT, () => {
              ws.close();
              res();
            });
          } catch {
            res();
          }
          setTimeout(res, 1000);
        }),
    };
  });

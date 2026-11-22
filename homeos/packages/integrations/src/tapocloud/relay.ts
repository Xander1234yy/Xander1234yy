/**
 * Live beeld van een Tapo-camera via het videorelais van de TP-Link-cloud — NIET-OFFICIEEL (zoals de Tapo-app;
 * gevolgd naar tapo-view en ndroo/cameras). Het relais levert MPEG-TS (H.264) in multipart-delen; HomeOS geeft de
 * videodelen ongewijzigd door aan de browser en slaat niets op.
 *
 * 1. POST {cipc}/v2/relay/request → relayUrl + relayToken.
 * 2. TLS naar het relais, één lange POST (multipart/mixed) met de previewaanvraag; hartslag elke 20 s en een
 *    ontvangstbevestiging per 25 delen.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { connect as tlsConnect } from "node:tls";
import { rootCertificates } from "node:tls";
import type { Duplex } from "node:stream";
import { TPLINK_CA_PEM } from "./ca";
import { TapoCloudError, httpsTapo, isTplinkHost, type TapoHttp } from "./client";

const APP_TYPE = "TP-Link_Tapo_Android";
const APP_VERSION = "3.22.304";
const CLIENT_BOUNDARY = "----client-stream-boundary--";
const DEVICE_BOUNDARY = Buffer.from("----device-stream-boundary--");

export type RelaySocket = (host: string, port: number) => Promise<Duplex>;

export const tlsRelaySocket: RelaySocket = (host, port) =>
  new Promise((resolve, reject) => {
    const s = tlsConnect({ host, port, servername: host, ca: [...rootCertificates, TPLINK_CA_PEM], timeout: 20_000 }, () => resolve(s));
    s.once("error", (e) => reject(new TapoCloudError(`Videorelais niet bereikbaar: ${e.message}`, "UNAVAILABLE")));
    s.once("timeout", () => s.destroy(new Error("time-out")));
  });

export interface RelayInfo {
  host: string;
  port: number;
  path: string;
  token: string;
  sessionToken: string | null;
  cookie: string | null;
}

/** Vraagt een relais aan voor deze camera. */
export async function requestRelay(o: { cipc: string; token: string; deviceId: string; playerId: string; resolution: "HD" | "VGA"; deviceType?: "SMART.IPCAMERA" | "SMART.TAPODOORBELL"; http?: TapoHttp }): Promise<RelayInfo> {
  const http = o.http ?? httpsTapo;
  const body = JSON.stringify({ deviceId: o.deviceId, playerId: o.playerId, cloudType: 2, deviceType: o.deviceType ?? "SMART.IPCAMERA", rootCaVer: "1", preConnection: 0, resolution: o.resolution, streamType: 0, dataTimeoutCount: 0 });
  const res = await http(`${o.cipc}/v2/relay/request`, {
    method: "POST",
    headers: {
      "content-type": "application/json;charset=UTF-8",
      authorization: o.token,
      "user-agent": `Tapo_APP/HomeOS/${APP_VERSION}_Android/Android 14`,
      "x-request-signature": randomBytes(5).toString("hex"),
      "x-client-id": o.playerId,
      "x-source": "tapo-app",
      "x-brand": "TPLINK",
      "x-ca-type": "cloud-self",
      accept: "*/*",
    },
    body,
  });
  if (res.status === 401 || res.status === 403) throw new TapoCloudError("De aanmelding bij TP-Link is verlopen", "EXPIRED");
  let data: { errorCode?: number; error_code?: number; msg?: string; result?: Record<string, string> } & Record<string, unknown>;
  try {
    data = JSON.parse(res.text);
  } catch {
    throw new TapoCloudError(`Onverwacht antwoord van het videorelais (${res.status})`, "FAILED");
  }
  const code = Number(data.errorCode ?? data.error_code ?? 0);
  if (code !== 0) throw new TapoCloudError(code === -20651 || code === -20675 ? "De aanmelding bij TP-Link is verlopen" : `Geen live beeld beschikbaar (${code})`, code === -20651 || code === -20675 ? "EXPIRED" : "CAMERA", code);
  const r = (data.result ?? data) as Record<string, string>;
  if (!r.relayUrl) throw new TapoCloudError("Het videorelais gaf geen adres", "FAILED");
  const u = new URL(r.relayUrl.includes("://") ? r.relayUrl : `https://${r.relayUrl}`);
  if (!isTplinkHost(u.hostname) && !/(^|\.)tplinkra\.com$/.test(u.hostname) && !/(^|\.)tplinkcloud\.com\.cn$/.test(u.hostname)) {
    throw new TapoCloudError("Onverwacht adres van het videorelais", "FAILED");
  }
  return {
    host: u.hostname,
    port: Number(u.port || 443),
    path: (u.pathname || "/") + u.search,
    token: r.relayToken || r.sessionToken || "",
    sessionToken: r.sessionToken || null,
    cookie: r.elbCookie || null,
  };
}

export function multipartPart(payload: string, extra: Record<string, string> = {}): Buffer {
  const raw = Buffer.from(payload, "utf8");
  const lines = [CLIENT_BOUNDARY, "Content-Type: application/json", `Content-Length: ${raw.length}`, ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`)];
  return Buffer.concat([Buffer.from(lines.join("\r\n") + "\r\n\r\n"), raw, Buffer.from("\r\n")]);
}

export function relayHead(r: RelayInfo, clientUuid: string): Buffer {
  const lines = [
    `POST ${r.path} HTTP/1.1`,
    `User-Agent: Client=${APP_TYPE} Android ${APP_VERSION}/1.3`,
    "Keep-Relay: 3600",
    "Accept: */*",
    "Content-Type: multipart/mixed;boundary=--client-stream-boundary--",
    `Host: ${r.host}`,
    "Content-Length: 9223372036854775807",
    `X-token: ${r.token}`,
    "X-Client-Model: HomeOS",
    `X-Client-UUID: ${clientUuid}`,
    "X-Redirect-Times: 0",
    "X-Pull-Mode: 2",
    "X-Version: 2.0",
    "X-Arrive-Latency: 0",
  ];
  if (r.sessionToken && r.sessionToken !== r.token) lines.push(`X-Client-SessionID: ${r.sessionToken}`);
  if (r.cookie) lines.push(`Cookie: ${r.cookie}`);
  return Buffer.from(lines.join("\r\n") + "\r\n\r\n");
}

export interface RelayPart {
  headers: Record<string, string>;
  body: Buffer;
}
/** Haalt complete delen van de camera uit de buffer; geeft de rest terug. `end` = het relais sloot de stroom. */
export function splitDeviceParts(buf: Buffer): { parts: RelayPart[]; rest: Buffer; end: boolean } {
  const parts: RelayPart[] = [];
  let rest = buf;
  for (;;) {
    const start = rest.indexOf(DEVICE_BOUNDARY);
    if (start < 0) break;
    const after = rest.subarray(start + DEVICE_BOUNDARY.length);
    if (after.subarray(0, 2).toString() === "--") return { parts, rest: Buffer.alloc(0), end: true };
    const headerEnd = after.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;
    const headers: Record<string, string> = {};
    for (const line of after.subarray(0, headerEnd).toString("latin1").split("\r\n")) {
      const i = line.indexOf(":");
      if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    const len = Number.parseInt(headers["content-length"] ?? "0", 10) || 0;
    const bodyAt = headerEnd + 4;
    if (after.length < bodyAt + len) break;
    parts.push({ headers, body: after.subarray(bodyAt, bodyAt + len) });
    rest = after.subarray(bodyAt + len);
  }
  return { parts, rest, end: false };
}

/**
 * Opent het relais en levert MPEG-TS-stukken tot `signal` afbreekt, `maxMs` verstreken is of het relais sluit.
 * Gooit een duidelijke fout als het relais weigert of 30 s niets stuurt.
 */
export async function* relayStream(o: { relay: RelayInfo; resolution: "HD" | "VGA"; signal?: AbortSignal; maxMs?: number; socket?: RelaySocket }): AsyncGenerator<Buffer> {
  const sock = await (o.socket ?? tlsRelaySocket)(o.relay.host, o.relay.port);
  const clientUuid = randomUUID();
  const queue: Buffer[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  let failure: Error | null = null;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  sock.on("data", (c: Buffer) => {
    queue.push(c);
    notify();
  });
  sock.on("end", () => ((closed = true), notify()));
  sock.on("close", () => ((closed = true), notify()));
  sock.on("error", (e) => ((failure = e), notify()));
  const send = (b: Buffer) => {
    if (!sock.destroyed) sock.write(b);
  };
  const deadline = Date.now() + (o.maxMs ?? 240_000);
  const onAbort = () => ((closed = true), notify());
  o.signal?.addEventListener("abort", onAbort);
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const next = async (timeoutMs: number): Promise<Buffer | null> => {
    if (queue.length) return queue.shift()!;
    if (closed || failure) return null;
    await new Promise<void>((r) => {
      wake = r;
      setTimeout(r, timeoutMs);
    });
    return queue.shift() ?? null;
  };
  try {
    sock.write(relayHead(o.relay, clientUuid));
    // Antwoordkop lezen.
    let buf: Buffer = Buffer.alloc(0);
    while (buf.indexOf("\r\n\r\n") < 0) {
      const c = await next(20_000);
      if (!c) throw failure ?? new TapoCloudError("Het videorelais antwoordt niet", "UNAVAILABLE");
      buf = Buffer.concat([buf, c]);
      if (buf.length > 64_000) throw new TapoCloudError("Onverwacht antwoord van het videorelais", "FAILED");
    }
    const headEnd = buf.indexOf("\r\n\r\n");
    const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(buf.subarray(0, headEnd).toString("latin1"))?.[1] ?? 0);
    if (status !== 200) throw new TapoCloudError(`Het videorelais weigerde de verbinding (${status || "onbekend"})`, status === 401 || status === 403 ? "EXPIRED" : "CAMERA");
    buf = buf.subarray(headEnd + 4);
    send(multipartPart(JSON.stringify({ type: "request", seq: 1, params: { method: "get", preview: { channels: [0], resolutions: [o.resolution], audio: ["default"] } } }), { "X-Data-Window-Size": "50" }));
    heartbeat = setInterval(() => send(multipartPart(JSON.stringify({ type: "notification", params: { event_type: "heartbeat" } }))), 20_000);
    heartbeat.unref?.();
    let sessionId = "";
    let quietSince = Date.now();
    while (!o.signal?.aborted && Date.now() < deadline) {
      const r = splitDeviceParts(buf);
      buf = r.rest;
      for (const p of r.parts) {
        sessionId = p.headers["x-session-id"] || sessionId;
        const type = p.headers["content-type"] ?? "";
        if (type === "video/mp2t" && p.body.length) {
          quietSince = Date.now();
          yield Buffer.from(p.body);
          const seq = p.headers["x-data-sequence"];
          if (sessionId && seq && /^\d+$/.test(seq) && Number(seq) % 25 === 0) {
            send(multipartPart(JSON.stringify({ type: "notification", params: { event_type: "stream_sequence" } }), { "X-Data-Received": seq, "X-Session-Id": sessionId }));
          }
        } else if (type === "application/json" && p.body.length) {
          try {
            const m = JSON.parse(p.body.toString("utf8")) as { params?: { session_id?: string; error_code?: number } };
            if (m.params?.session_id) sessionId = String(m.params.session_id);
            if (typeof m.params?.error_code === "number" && m.params.error_code < 0) throw new TapoCloudError(`De camera weigert live beeld (${m.params.error_code})`, "CAMERA", m.params.error_code);
          } catch (e) {
            if (e instanceof TapoCloudError) throw e;
          }
        }
      }
      if (r.end) return;
      if (Date.now() - quietSince > 30_000) throw new TapoCloudError("Het videorelais stuurt geen beeld meer", "UNAVAILABLE");
      const c = await next(1_000);
      if (c) buf = Buffer.concat([buf, c]);
      else if (closed || failure) {
        if (failure && !o.signal?.aborted) throw new TapoCloudError(`Videorelais verbroken: ${(failure as Error).message}`, "UNAVAILABLE");
        return;
      }
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    o.signal?.removeEventListener("abort", onAbort);
    sock.destroy();
  }
}

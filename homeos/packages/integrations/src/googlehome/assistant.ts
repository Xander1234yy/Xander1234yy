/**
 * Google Assistant SDK (officiële Google API, Embedded Assistant v1alpha2) — alleen tekstopdrachten.
 * HomeOS stuurt een zin zoals "zet GRILLPLATS aan" naar het Google-account van de gebruiker, alsof die het tegen
 * Google zegt. Google meldt níet terug of het apparaat werkelijk schakelde; dat tonen we ook zo.
 *
 * gRPC zonder extra pakketten: één AssistRequest (protobuf, met de hand gecodeerd) via HTTP/2, antwoorden decoderen
 * we alleen voor de tekst en de gRPC-status.
 */
import { connect as http2Connect } from "node:http2";

export const ASSISTANT_SCOPE = "https://www.googleapis.com/auth/assistant-sdk-prototype";
export const ASSISTANT_HOST = "embeddedassistant.googleapis.com";
const ASSIST_PATH = "/google.assistant.embedded.v1alpha2.EmbeddedAssistant/Assist";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export class GoogleAssistantError extends Error {
  constructor(
    message: string,
    readonly code: "UNAUTHORIZED" | "RATE_LIMITED" | "UNAVAILABLE" | "INVALID" | "FAILED",
  ) {
    super(message);
  }
}

// ---------- protobuf (alleen wat we nodig hebben) ----------

function varint(n: number): number[] {
  const out: number[] = [];
  let v = n >>> 0;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return out;
}
const tag = (field: number, wire: number) => varint((field << 3) | wire);
const bytesField = (field: number, data: Uint8Array | number[]) => [...tag(field, 2), ...varint(data.length), ...data];
const stringField = (field: number, s: string) => bytesField(field, [...Buffer.from(s, "utf8")]);
const intField = (field: number, n: number) => [...tag(field, 0), ...varint(n)];

/** AssistRequest{ config(1): AssistConfig{ audio_out_config(2), dialog_state_in(3), device_config(4), text_query(6), screen_out_config(8) } }. */
export function encodeAssistRequest(text: string, languageCode: string, deviceModelId = "default", deviceId = "default"): Buffer {
  // Veldnummers volgens google/assistant/embedded/v1alpha2/embedded_assistant.proto (zoals Google's textinput-voorbeeld).
  const audioOut = [...intField(1, 2 /* MP3 */), ...intField(2, 24000), ...intField(3, 100)];
  const device = [...stringField(1, deviceId), ...stringField(3, deviceModelId)];
  const dialog = [...stringField(2, languageCode), ...intField(7, 1 /* is_new_conversation */)];
  const screen = intField(1, 3 /* PLAYING */);
  const config = [
    ...bytesField(2, audioOut),
    ...bytesField(3, dialog), // dialog_state_in = 3
    ...bytesField(4, device), // device_config = 4
    ...stringField(6, text),
    ...bytesField(8, screen),
  ];
  return Buffer.from(bytesField(1, config));
}

interface Field {
  field: number;
  wire: number;
  value: number | Buffer;
}
function readVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (pos >= buf.length) throw new Error("Onvolledig protobuf-bericht");
    const b = buf[pos++]!;
    if (shift < 28) result |= (b & 0x7f) << shift;
    else result += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return [result, pos];
    shift += 7;
    if (shift > 63) throw new Error("Ongeldige varint");
  }
}
export function decodeFields(buf: Buffer): Field[] {
  const out: Field[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const [key, p1] = readVarint(buf, pos);
    pos = p1;
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) {
      const [v, p2] = readVarint(buf, pos);
      out.push({ field, wire, value: v });
      pos = p2;
    } else if (wire === 2) {
      const [len, p2] = readVarint(buf, pos);
      if (p2 + len > buf.length) throw new Error("Onvolledig protobuf-veld");
      out.push({ field, wire, value: buf.subarray(p2, p2 + len) });
      pos = p2 + len;
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else throw new Error(`Onbekend protobuf-type ${wire}`);
  }
  return out;
}

/** Haalt de tekst uit AssistResponse (dialog_state_out.supplemental_display_text = 5.1). */
export function decodeAssistResponse(msg: Buffer): { text: string | null } {
  let text: string | null = null;
  for (const f of decodeFields(msg)) {
    if (f.field === 5 && Buffer.isBuffer(f.value)) {
      for (const g of decodeFields(f.value)) if (g.field === 1 && Buffer.isBuffer(g.value) && g.value.length) text = g.value.toString("utf8");
    }
  }
  return { text };
}

/** gRPC-berichtkader: 1 byte (geen compressie) + 4 bytes lengte + bericht. */
export function frame(msg: Buffer): Buffer {
  const head = Buffer.alloc(5);
  head.writeUInt32BE(msg.length, 1);
  return Buffer.concat([head, msg]);
}
export function unframe(data: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let pos = 0;
  while (pos + 5 <= data.length) {
    const len = data.readUInt32BE(pos + 1);
    if (pos + 5 + len > data.length) break;
    out.push(data.subarray(pos + 5, pos + 5 + len));
    pos += 5 + len;
  }
  return out;
}

// ---------- transport ----------

/** Stuurt één tekstopdracht; geeft de (eventuele) tekst van Google terug. Injecteerbaar voor tests. */
export type AssistantTransport = (accessToken: string, text: string, languageCode: string) => Promise<{ text: string | null }>;

function grpcError(status: number, message: string): GoogleAssistantError {
  const m = message ? decodeURIComponent(message) : `gRPC-status ${status}`;
  if (status === 16) return new GoogleAssistantError("Google weigert de aanmelding (opnieuw koppelen?)", "UNAUTHORIZED");
  if (status === 7) return new GoogleAssistantError(`Geen toegang: zet de 'Google Assistant API' aan in je Google Cloud-project (${m})`, "UNAUTHORIZED");
  if (status === 8) return new GoogleAssistantError("Te veel opdrachten naar Google; probeer het later opnieuw", "RATE_LIMITED");
  if (status === 14 || status === 4) return new GoogleAssistantError("Google Assistent is tijdelijk niet bereikbaar", "UNAVAILABLE");
  if (status === 3) return new GoogleAssistantError(`Google begreep de aanvraag niet (${m})`, "INVALID");
  return new GoogleAssistantError(`Google Assistent gaf een fout: ${m}`, "FAILED");
}

/** Transport via HTTP/2 naar Google (origin alleen aan te passen in tests, met een lokale nep-server). */
export function createHttp2AssistantTransport(origin = `https://${ASSISTANT_HOST}`, timeoutMs = 20_000): AssistantTransport {
  return (accessToken, text, languageCode) => assist(origin, timeoutMs, accessToken, text, languageCode);
}
export const http2AssistantTransport: AssistantTransport = createHttp2AssistantTransport();

function assist(origin: string, timeoutMs: number, accessToken: string, text: string, languageCode: string): Promise<{ text: string | null }> {
  return new Promise((resolve, reject) => {
    const session = http2Connect(origin);
    const fail = (e: unknown) => {
      session.close();
      reject(e instanceof GoogleAssistantError ? e : new GoogleAssistantError(`Google Assistent niet bereikbaar: ${(e as Error).message}`, "UNAVAILABLE"));
    };
    session.on("error", fail);
    session.setTimeout(timeoutMs, () => fail(new Error("time-out")));
    const req = session.request({
      ":method": "POST",
      ":path": ASSIST_PATH,
      "content-type": "application/grpc",
      te: "trailers",
      authorization: `Bearer ${accessToken}`,
    });
    const chunks: Buffer[] = [];
    let headerStatus: number | null = null;
    let headerMessage = "";
    req.on("response", (h) => {
      if (h["grpc-status"] !== undefined) {
        headerStatus = Number(h["grpc-status"]);
        headerMessage = String(h["grpc-message"] ?? "");
      } else if (h[":status"] && Number(h[":status"]) !== 200) {
        const s = Number(h[":status"]);
        headerStatus = s === 401 ? 16 : s === 403 ? 7 : s === 429 ? 8 : 14;
      }
    });
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("trailers", (t) => {
      if (t["grpc-status"] !== undefined) {
        headerStatus = Number(t["grpc-status"]);
        headerMessage = String(t["grpc-message"] ?? "");
      }
    });
    req.on("error", fail);
    req.on("end", () => {
      session.close();
      if (headerStatus !== null && headerStatus !== 0) return reject(grpcError(headerStatus, headerMessage));
      try {
        let textOut: string | null = null;
        for (const m of unframe(Buffer.concat(chunks))) textOut = decodeAssistResponse(m).text ?? textOut;
        resolve({ text: textOut });
      } catch (e) {
        reject(new GoogleAssistantError(`Onverwacht antwoord van Google: ${(e as Error).message}`, "FAILED"));
      }
    });
    req.end(frame(encodeAssistRequest(text, languageCode)));
  });
}

// ---------- OAuth ----------

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export function googleAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", ASSISTANT_SCOPE);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(f: typeof fetch, body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  let res: Response;
  try {
    res = await f(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString(), signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new GoogleAssistantError(`Google niet bereikbaar: ${(e as Error).message}`, "UNAVAILABLE");
  }
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    const code = json.error === "invalid_grant" || res.status === 400 || res.status === 401 ? "UNAUTHORIZED" : res.status === 429 ? "RATE_LIMITED" : "FAILED";
    throw new GoogleAssistantError(`Google-aanmelding mislukt: ${json.error_description ?? json.error ?? res.status}`, code);
  }
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_in: json.expires_in ?? 3600 };
}

export async function exchangeGoogleCode(f: typeof fetch, clientId: string, clientSecret: string, code: string, redirectUri: string, now = Date.now()): Promise<GoogleTokens> {
  const r = await tokenRequest(f, { grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri });
  if (!r.refresh_token) throw new GoogleAssistantError("Google gaf geen vernieuwingssleutel terug; verwijder de toegang bij myaccount.google.com en probeer opnieuw", "FAILED");
  return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: now + r.expires_in * 1000 };
}

export async function refreshGoogleTokens(f: typeof fetch, clientId: string, clientSecret: string, refreshToken: string, now = Date.now()): Promise<GoogleTokens> {
  const r = await tokenRequest(f, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret });
  return { accessToken: r.access_token, refreshToken: r.refresh_token ?? refreshToken, expiresAt: now + r.expires_in * 1000 };
}

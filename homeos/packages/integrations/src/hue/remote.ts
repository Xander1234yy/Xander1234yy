import type { AdapterContext } from "../adapter";
import type { HueHttp, HueResponse } from "./net";

/**
 * Officiële Hue Remote API (developers.meethue.com): bediening via de Hue-cloud, zonder apparaat in het eigen netwerk.
 * 1. Gebruiker registreert een "Remote Hue API app" (client-ID/secret, callback-URL = HomeOS).
 * 2. OAuth2 autorisatie (api.meethue.com/v2/oauth2/authorize) → code → tokens.
 * 3. Eenmalig een application key aanmaken via de cloud (linkbutton + POST /route/api).
 * 4. CLIP v2 via https://api.meethue.com/route/clip/v2/... met Bearer-token en hue-application-key.
 */

export const HUE_REMOTE = "https://api.meethue.com";

export interface HueRemoteTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class HueRemoteError extends Error {
  constructor(
    message: string,
    readonly code: "UNAUTHORIZED" | "RATE_LIMITED" | "UNREACHABLE" | "INVALID" | "SERVER",
  ) {
    super(message);
  }
}

export function hueAuthorizeUrl(clientId: string, state: string): string {
  const u = new URL(`${HUE_REMOTE}/v2/oauth2/authorize`);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(fetchImpl: typeof fetch, clientId: string, clientSecret: string, params: Record<string, string>): Promise<HueRemoteTokens> {
  let res: Response;
  try {
    res = await fetchImpl(`${HUE_REMOTE}/v2/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
  } catch {
    throw new HueRemoteError("De Hue-cloud is niet bereikbaar", "UNREACHABLE");
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 || res.status === 400) throw new HueRemoteError("De Hue-cloud weigert de aanmelding. Koppel opnieuw.", "UNAUTHORIZED");
  if (!res.ok || typeof json.access_token !== "string" || typeof json.refresh_token !== "string") throw new HueRemoteError(`Hue-cloud gaf status ${res.status}`, "SERVER");
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : Number(json.expires_in) || 7 * 86400;
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + expiresIn * 1000 };
}

export const exchangeHueCode = (f: typeof fetch, clientId: string, clientSecret: string, code: string) => tokenRequest(f, clientId, clientSecret, { grant_type: "authorization_code", code });
export const refreshHueTokens = (f: typeof fetch, clientId: string, clientSecret: string, refreshToken: string) => tokenRequest(f, clientId, clientSecret, { grant_type: "refresh_token", refresh_token: refreshToken });

/** Eenmalig: application key aanmaken via de cloud (de cloud drukt virtueel op de link-knop). */
export async function createRemoteAppKey(f: typeof fetch, accessToken: string): Promise<string> {
  const h = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
  const link = await f(`${HUE_REMOTE}/route/api/0/config`, { method: "PUT", headers: h, body: JSON.stringify({ linkbutton: true }), signal: AbortSignal.timeout(15_000) });
  if (!link.ok) throw new HueRemoteError(`Link-knop via de cloud mislukt (status ${link.status})`, link.status === 401 ? "UNAUTHORIZED" : "SERVER");
  const res = await f(`${HUE_REMOTE}/route/api`, { method: "POST", headers: h, body: JSON.stringify({ devicetype: "homeos#cloud" }), signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => null)) as { success?: { username?: string }; error?: { description?: string } }[] | null;
  const username = body?.[0]?.success?.username;
  if (!res.ok || !username) throw new HueRemoteError(body?.[0]?.error?.description ?? `Application key aanmaken mislukt (status ${res.status})`, "SERVER");
  return username;
}

/**
 * HueHttp over de Hue-cloud. Vernieuwt het toegangstoken automatisch en bewaart het (versleuteld) via ctx.secrets.
 * Geen eventstream (de adapter ververst periodiek).
 */
export function createHueRemoteHttp(o: { appKey: string; ctx: AdapterContext; clientId: string; fetchImpl?: typeof fetch }): HueHttp {
  const f = o.fetchImpl ?? fetch;
  let tokens: HueRemoteTokens | null = null;
  const token = async (force = false) => {
    if (!tokens) {
      const raw = await o.ctx.secrets.get("tokens");
      tokens = raw ? (JSON.parse(raw) as HueRemoteTokens) : null;
    }
    if (!tokens) throw new HueRemoteError("Niet aangemeld bij de Hue-cloud", "UNAUTHORIZED");
    if (force || tokens.expiresAt - 5 * 60_000 < Date.now()) {
      const secret = await o.ctx.secrets.get("clientSecret");
      if (!secret) throw new HueRemoteError("Client secret ontbreekt; koppel opnieuw", "UNAUTHORIZED");
      tokens = await refreshHueTokens(f, o.clientId, secret, tokens.refreshToken);
      await o.ctx.secrets.set("tokens", JSON.stringify(tokens));
    }
    return tokens.accessToken;
  };
  const send = async <T>(method: string, path: string, body: unknown, timeoutMs: number, retry: boolean): Promise<HueResponse<T>> => {
    if (!path.startsWith("/clip/v2/")) throw new HueRemoteError("Alleen CLIP v2 via de cloud", "INVALID");
    let res: Response;
    try {
      res = await f(`${HUE_REMOTE}/route${path}`, {
        method,
        headers: { authorization: `Bearer ${await token()}`, "hue-application-key": o.appKey, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch (e) {
      if (e instanceof HueRemoteError) throw e;
      throw new HueRemoteError("De Hue-cloud is niet bereikbaar", "UNREACHABLE");
    }
    if (res.status === 401 && retry) {
      await token(true);
      return send<T>(method, path, body, timeoutMs, false);
    }
    if (res.status === 429) throw new HueRemoteError("Te veel verzoeken aan de Hue-cloud; even wachten", "RATE_LIMITED");
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new HueRemoteError("Ongeldig antwoord van de Hue-cloud", "SERVER");
    }
    return { status: res.status, body: json as T };
  };
  return {
    request: <T>(method: "GET" | "PUT" | "POST", path: string, body?: unknown, timeoutMs = 15_000) => send<T>(method, path, body, timeoutMs, true),
    stream: async () => {
      throw new Error("Geen eventstream via de Hue-cloud");
    },
  };
}

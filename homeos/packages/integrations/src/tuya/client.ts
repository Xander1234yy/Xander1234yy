import { createHash, createHmac } from "node:crypto";
import { CloudApiError } from "../cloud/budget";

/**
 * Minimale client voor de officiële Tuya Cloud OpenAPI (IoT Core), volgens het ondertekeningsschema uit Tuya's
 * eigen SDK's (tuya-connector-nodejs / tuya-iot-py-sdk):
 *   stringToSign = METHOD \n SHA256(body) \n \n path?gesorteerde-query
 *   sign = HMAC-SHA256(clientId + [accessToken] + t + stringToSign, secret).toUpperCase()
 */
export const TUYA_REGIONS = {
  eu: { label: "Centraal-Europa", url: "https://openapi.tuyaeu.com" },
  "eu-west": { label: "West-Europa", url: "https://openapi-weaz.tuyaeu.com" },
  us: { label: "Westelijk Amerika", url: "https://openapi.tuyaus.com" },
  "us-east": { label: "Oostelijk Amerika", url: "https://openapi-ueaz.tuyaus.com" },
  cn: { label: "China", url: "https://openapi.tuyacn.com" },
  in: { label: "India", url: "https://openapi.tuyain.com" },
} as const;
export type TuyaRegion = keyof typeof TUYA_REGIONS;

export interface TuyaCredentials {
  region: TuyaRegion;
  accessId: string;
  accessSecret: string;
}

interface TokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface TuyaResponse<T> {
  success: boolean;
  result: T;
  code?: number;
  msg?: string;
  t?: number;
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function tuyaStringToSign(method: string, path: string, query: Record<string, string | number> = {}, body?: unknown): string {
  const keys = Object.keys(query).sort();
  const url = keys.length ? `${path}?${keys.map((k) => `${k}=${query[k]}`).join("&")}` : path;
  const bodyStr = body === undefined ? "" : JSON.stringify(body);
  return [method, sha256(bodyStr), "", url].join("\n");
}

export function tuyaSign(clientId: string, secret: string, t: string, stringToSign: string, accessToken = "", nonce = ""): string {
  return createHmac("sha256", secret).update(clientId + accessToken + t + nonce + stringToSign, "utf8").digest("hex").toUpperCase();
}

/** Tuya-foutcodes die betekenen dat het token opnieuw moet. */
const TOKEN_ERRORS = new Set([1010, 1011, 1012]);

export class TuyaClient {
  private token: TokenInfo | null = null;

  constructor(
    private readonly creds: TuyaCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private get base() {
    return TUYA_REGIONS[this.creds.region].url;
  }

  private async raw<T>(method: "GET" | "POST", path: string, query: Record<string, string | number> = {}, body?: unknown, withToken = true): Promise<TuyaResponse<T>> {
    const t = String(this.now());
    const token = withToken ? (this.token?.accessToken ?? "") : "";
    const sign = tuyaSign(this.creds.accessId, this.creds.accessSecret, t, tuyaStringToSign(method, path, query, body), token);
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}${qs ? `?${qs}` : ""}`, {
        method,
        headers: {
          client_id: this.creds.accessId,
          sign,
          t,
          sign_method: "HMAC-SHA256",
          ...(token ? { access_token: token } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new CloudApiError("Tuya-cloud niet bereikbaar", "network");
    }
    if (res.status === 429) throw new CloudApiError("Tuya-limiet bereikt", "rate_limited");
    const json = (await res.json().catch(() => null)) as TuyaResponse<T> | null;
    if (!json) throw new CloudApiError(`Tuya gaf status ${res.status}`, "server");
    return json;
  }

  private async ensureToken(force = false): Promise<void> {
    if (!force && this.token && this.token.expiresAt > this.now()) return;
    const r = await this.raw<{ access_token: string; refresh_token: string; expire_time: number }>("GET", "/v1.0/token", { grant_type: 1 }, undefined, false);
    if (!r.success) {
      const msg = r.code === 1004 ? "Ongeldige handtekening: controleer Access ID en Access Secret" : r.code === 1106 || r.code === 2009 ? "Geen toegang: controleer je Tuya-project en datacenter" : (r.msg ?? "Aanmelden bij Tuya mislukt");
      throw new CloudApiError(`Tuya: ${msg}`, "auth");
    }
    this.token = { accessToken: r.result.access_token, refreshToken: r.result.refresh_token, expiresAt: this.now() + Math.max(60, r.result.expire_time - 60) * 1000 };
  }

  async request<T>(method: "GET" | "POST", path: string, query: Record<string, string | number> = {}, body?: unknown): Promise<T> {
    await this.ensureToken();
    let r = await this.raw<T>(method, path, query, body);
    if (!r.success && r.code && TOKEN_ERRORS.has(r.code)) {
      await this.ensureToken(true);
      r = await this.raw<T>(method, path, query, body);
    }
    if (!r.success) {
      const quota = r.code === 28841004 || /quota|limit/i.test(r.msg ?? "");
      throw new CloudApiError(quota ? "Het API-quotum van je Tuya-project is op. Verleng of upgrade het abonnement in de Tuya-console." : `Tuya: ${r.msg ?? `fout ${r.code}`}`, quota ? "rate_limited" : "server");
    }
    return r.result;
  }
}

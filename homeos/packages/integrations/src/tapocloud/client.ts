/**
 * Tapo-camera's via de TP-Link-cloud — NIET-OFFICIËLE koppeling, op uitdrukkelijk verzoek van de gebruiker.
 * TP-Link biedt geen openbare camera-API; dit volgt de Tapo-app zoals gedocumenteerd door community-projecten
 * (tapo-cli, tapo-view, python-tapo-local, ioBroker.tapo). Kan zonder aankondiging stoppen.
 *
 * - Account-API (v2): ondertekende POST's (HMAC-SHA1 met de app-sleutels uit de Tapo-app).
 * - IoT-app-server: cameraopdrachten (privacymodus, draaien) via `services-sync` met het accounttoken.
 * - Meldingen: de meldingengeschiedenis van de app (beweging, persoon, deurbel), zonder Tapo Care.
 * Alleen https naar TP-Link-hosts (*.tplinkcloud.com, *.tplinknbu.com), met TP-Links eigen CA-keten.
 */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { rootCertificates } from "node:tls";
import { TPLINK_CA_PEM } from "./ca";

export const TAPO_GATEWAY = "https://n-wap.i.tplinkcloud.com";
const APP_TYPE = "TP-Link_Tapo_Android";
const APP_VERSION = "3.22.304";
const ACCESS_KEY = "4d11b6b9d5ea4d19a829adbb9714b057";
const SECRET_KEY = "6ed7d97f3e73467f8a5bab90b577ba4c";
const SIGN_TIMESTAMP = "9999999999";
const MFA_REQUIRED = -20677;

export class TapoCloudError extends Error {
  constructor(
    message: string,
    readonly code: "UNAUTHORIZED" | "EXPIRED" | "UNAVAILABLE" | "FAILED" | "CAMERA",
    readonly apiCode?: number,
  ) {
    super(message);
  }
}

export function isTplinkHost(hostname: string): boolean {
  return /(^|\.)tplinkcloud\.com$/.test(hostname) || /(^|\.)tplinknbu\.com$/.test(hostname);
}

// ---------- transport ----------

export type TapoHttp = (url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text: string }>;

const CA = [...rootCertificates, TPLINK_CA_PEM];

/** Echte HTTPS met de standaard-CA's plus TP-Links eigen keten; geen redirects, alleen TP-Link-hosts. */
export const httpsTapo: TapoHttp = (url, init) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== "https:" || !isTplinkHost(u.hostname)) return reject(new TapoCloudError("Onverwacht adres", "FAILED"));
    const req = httpsRequest(
      { host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: init.method, headers: { ...init.headers, ...(init.body ? { "content-length": Buffer.byteLength(init.body) } : {}) }, ca: CA, timeout: 20_000 },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("time-out")));
    req.on("error", (e) => reject(new TapoCloudError(`TP-Link niet bereikbaar: ${e.message}`, "UNAVAILABLE")));
    req.end(init.body);
  });

export function signature(body: string, path: string, nonce: string): { md5: string; authorization: string } {
  const md5 = createHash("md5").update(body).digest("base64");
  const sig = createHmac("sha1", SECRET_KEY).update(`${md5}\n${SIGN_TIMESTAMP}\n${nonce}\n${path}`).digest("hex");
  return { md5, authorization: `Timestamp=${SIGN_TIMESTAMP}, Nonce=${nonce}, AccessKey=${ACCESS_KEY}, Signature=${sig}` };
}

// ---------- typen ----------

export interface TapoCamera {
  deviceId: string;
  name: string;
  model: string;
  type: "camera" | "doorbell";
}
export type TapoLogin =
  | { kind: "ok"; base: string; token: string; refreshToken: string | null }
  | { kind: "mfa"; base: string; processId: string; mfaType: 1 | 2 };
export interface TapoNotification {
  deviceId: string;
  at: string;
  kind: "motion" | "person" | "ring" | "other";
  title: string;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
function decodeAlias(alias: string): string {
  if (alias.length >= 4 && alias.length % 4 === 0 && BASE64.test(alias)) {
    const d = Buffer.from(alias, "base64").toString("utf8");
    if (d && !/[\p{Cc}\uFFFD]/u.test(d)) return d;
  }
  return alias;
}

// ---------- client ----------

export class TapoCloudClient {
  constructor(
    readonly terminalUUID: string,
    private readonly http: TapoHttp = httpsTapo,
  ) {}

  private normalize(url: unknown): string {
    if (typeof url !== "string" || !url) throw new TapoCloudError("TP-Link gaf geen serveradres", "FAILED");
    const u = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
    if (u.protocol !== "https:" || !isTplinkHost(u.hostname)) throw new TapoCloudError("Onverwacht serveradres van TP-Link", "FAILED");
    return `https://${u.host}`;
  }

  /** Ondertekende POST naar de account-API; geeft `result` terug of gooit een duidelijke fout. */
  private async signed<T = Record<string, unknown>>(base: string, path: string, payload: unknown, token?: string, allow: number[] = []): Promise<{ result: T; code: number; msg: string }> {
    const body = JSON.stringify(payload);
    const { md5, authorization } = signature(body, path, randomUUID());
    const q = new URLSearchParams({ appName: APP_TYPE, appVer: APP_VERSION, netType: "wifi", termID: this.terminalUUID, ospf: "Android 14", brand: "TPLINK", locale: "nl_NL" });
    if (token) q.set("token", token);
    const res = await this.http(`${base}${path}?${q}`, { method: "POST", headers: { "content-type": "application/json;charset=UTF-8", "content-md5": md5, "x-authorization": authorization }, body });
    if (res.status === 429 || res.status >= 500) throw new TapoCloudError(`TP-Link is tijdelijk niet beschikbaar (${res.status})`, "UNAVAILABLE");
    let data: { error_code?: number; msg?: string; result?: Record<string, unknown> };
    try {
      data = JSON.parse(res.text);
    } catch {
      throw new TapoCloudError(`Onverwacht antwoord van TP-Link (${res.status})`, "FAILED");
    }
    const result = (data.result ?? {}) as Record<string, unknown>;
    const inner = result.errorCode !== undefined && result.errorCode !== "" && Number(result.errorCode) !== 0 ? Number(result.errorCode) : 0;
    const code = data.error_code && data.error_code !== 0 ? data.error_code : inner;
    const msg = String(data.msg ?? result.errorMsg ?? "");
    if (code !== 0 && !allow.includes(code)) {
      if (code === -20651 || code === -20675 || code === -20655) throw new TapoCloudError("De aanmelding bij TP-Link is verlopen", "EXPIRED", code);
      if (code === -20601 || code === -20600 || code === -20615) throw new TapoCloudError("TP-Link weigert de aanmelding: controleer je e-mailadres en wachtwoord", "UNAUTHORIZED", code);
      if (code === -20004) throw new TapoCloudError("Onjuiste verificatiecode", "UNAUTHORIZED", code);
      throw new TapoCloudError(`TP-Link gaf een fout${msg ? `: ${msg}` : ""} (${code})`, "FAILED", code);
    }
    return { result: result as T, code, msg };
  }

  async accountBase(email: string): Promise<string> {
    const r = await this.signed<{ appServerUrlV2?: string; appServerUrl?: string }>(TAPO_GATEWAY, "/api/v2/account/getAccountStatusAndUrl", { appType: APP_TYPE, cloudUserName: email });
    return this.normalize(r.result.appServerUrlV2 || r.result.appServerUrl || TAPO_GATEWAY);
  }

  async login(email: string, password: string): Promise<TapoLogin> {
    const base = await this.accountBase(email);
    const r = await this.signed<{ token?: string; refreshToken?: string; appServerUrl?: string; MFAProcessId?: string; mfaProcessId?: string }>(
      base,
      "/api/v2/account/login",
      { appType: APP_TYPE, appVersion: APP_VERSION, cloudUserName: email, cloudPassword: password, platform: "Android 14", refreshTokenNeeded: true, terminalUUID: this.terminalUUID, terminalName: "HomeOS", terminalMeta: "1", supportBindAccount: false },
      undefined,
      [MFA_REQUIRED],
    );
    const processId = r.result.MFAProcessId ?? r.result.mfaProcessId;
    if (r.code === MFA_REQUIRED || processId) {
      if (!processId) throw new TapoCloudError("TP-Link vraagt een verificatiecode maar gaf geen proces-ID", "FAILED");
      const mfaType = await this.sendMfaCode(base, email, password);
      return { kind: "mfa", base, processId, mfaType };
    }
    if (!r.result.token) throw new TapoCloudError("TP-Link gaf geen token terug", "FAILED");
    return { kind: "ok", base: r.result.appServerUrl ? this.normalize(r.result.appServerUrl) : base, token: r.result.token, refreshToken: r.result.refreshToken ?? null };
  }

  /** Verificatiecode sturen: eerst als melding in de Tapo-app, anders per e-mail. */
  private async sendMfaCode(base: string, email: string, password: string): Promise<1 | 2> {
    const body = { appType: APP_TYPE, cloudUserName: email, cloudPassword: password, terminalUUID: this.terminalUUID };
    try {
      await this.signed(base, "/api/v2/account/getPushVC4TerminalMFA", body);
      return 1;
    } catch {
      await this.signed(base, "/api/v2/account/getEmailVC4TerminalMFA", { ...body, locale: "nl_NL" });
      return 2;
    }
  }

  async completeMfa(base: string, email: string, processId: string, mfaType: 1 | 2, code: string): Promise<{ token: string; refreshToken: string | null; base: string }> {
    const r = await this.signed<{ token?: string; refreshToken?: string; appServerUrl?: string }>(base, "/api/v2/account/checkMFACodeAndLogin", {
      appType: APP_TYPE,
      cloudUserName: email,
      code,
      MFAProcessId: processId,
      MFAType: mfaType,
      terminalBindEnabled: true,
    });
    if (!r.result.token) throw new TapoCloudError("TP-Link gaf geen token terug", "FAILED");
    return { token: r.result.token, refreshToken: r.result.refreshToken ?? null, base: r.result.appServerUrl ? this.normalize(r.result.appServerUrl) : base };
  }

  async refresh(base: string, refreshToken: string): Promise<{ token: string; refreshToken: string }> {
    const r = await this.signed<{ token?: string; refreshToken?: string }>(base, "/api/v2/account/refreshToken", { appType: APP_TYPE, refreshToken, terminalUUID: this.terminalUUID });
    if (!r.result.token) throw new TapoCloudError("De aanmelding bij TP-Link is verlopen", "EXPIRED");
    return { token: r.result.token, refreshToken: r.result.refreshToken ?? refreshToken };
  }

  async cameras(base: string, token: string): Promise<TapoCamera[]> {
    const out: TapoCamera[] = [];
    for (let index = 0; index < 100; ) {
      const r = await this.signed<{ deviceList?: { deviceId?: string; deviceType?: string; deviceModel?: string; alias?: string; deviceName?: string }[]; totalNum?: number }>(
        base,
        "/api/v2/common/getDeviceListByPage",
        { deviceTypeList: ["SMART.IPCAMERA", "SMART.TAPODOORBELL"], index, limit: 20 },
        token,
      );
      const batch = r.result.deviceList ?? [];
      for (const d of batch) {
        if (typeof d.deviceId !== "string" || !/^[0-9A-Za-z]{8,80}$/.test(d.deviceId)) continue;
        out.push({
          deviceId: d.deviceId,
          name: decodeAlias(d.alias || d.deviceName || "Tapo-camera").slice(0, 80),
          model: (d.deviceModel ?? "").slice(0, 40),
          type: d.deviceType === "SMART.TAPODOORBELL" ? "doorbell" : "camera",
        });
      }
      index += batch.length;
      if (!batch.length || index >= (r.result.totalNum ?? index)) break;
    }
    return out;
  }

  async serviceUrl(base: string, token: string, serviceId: string): Promise<string> {
    const r = await this.signed<{ serviceUrls?: Record<string, string> }>(base, "/api/v2/common/getAppServiceUrl", { serviceIds: [serviceId] }, token);
    return this.normalize(r.result.serviceUrls?.[serviceId]);
  }

  /** Meldingen uit de Tapo-app sinds `sinceMs` (oplopend; alleen wat de gebruiker in de app aan heeft staan). */
  async notifications(base: string, token: string, sinceMs: number, maxPages = 4): Promise<TapoNotification[]> {
    const out: TapoNotification[] = [];
    let index = 0;
    for (let page = 0; page < maxPages; page++) {
      const r = await this.signed<{ notifications?: Record<string, unknown>[]; hasNextPage?: boolean; currentIndex?: number }>(
        base,
        "/api/v2/common/getAppNotificationByPage",
        { appType: APP_TYPE, terminalUUID: this.terminalUUID, mobileType: "ANDROID", deviceToken: "", locale: "nl_NL", direction: "asc", index, indexTime: sinceMs, limit: 50, contentVersion: 3 },
        token,
      );
      for (const n of r.result.notifications ?? []) out.push(...parseNotification(n));
      if (!r.result.hasNextPage) break;
      index = (r.result.currentIndex ?? index) + 1;
    }
    return out;
  }

  private iotHeaders(token: string): Record<string, string> {
    return {
      authorization: `ut|${token}`,
      "app-cid": `app:${APP_TYPE}:${this.terminalUUID}`,
      "x-app-name": APP_TYPE,
      "x-app-version": APP_VERSION,
      "x-term-id": this.terminalUUID,
      "x-ospf": "Android 14",
      "x-net-type": "wifi",
      "x-locale": "nl_NL",
      "content-type": "application/json;charset=UTF-8",
    };
  }

  /** Eén camera-opdracht via de IoT-app-server (passthrough → multipleRequest), zoals de Tapo-app. */
  async cameraCall(iotBase: string, token: string, deviceId: string, method: string, params: unknown): Promise<Record<string, unknown>> {
    const body = JSON.stringify({ serviceId: "passthrough", inputParams: { requestData: { method: "multipleRequest", params: { requests: [{ method, params }] } } } });
    const res = await this.http(`${iotBase}/v1/things/${encodeURIComponent(deviceId)}/services-sync`, { method: "POST", headers: this.iotHeaders(token), body });
    if (res.status === 401 || res.status === 403) throw new TapoCloudError("De aanmelding bij TP-Link is verlopen", "EXPIRED");
    if (res.status === 429 || res.status >= 500) throw new TapoCloudError(`TP-Link is tijdelijk niet beschikbaar (${res.status})`, "UNAVAILABLE");
    let data: { outputParams?: { responseData?: { result?: { responses?: { error_code?: number; result?: Record<string, unknown> }[] } } }; message?: string };
    try {
      data = JSON.parse(res.text);
    } catch {
      throw new TapoCloudError(`Onverwacht antwoord van TP-Link (${res.status})`, "FAILED");
    }
    if (res.status !== 200) throw new TapoCloudError(`Camera-opdracht mislukt: ${data.message ?? res.status}`, res.status === 404 ? "CAMERA" : "FAILED");
    const item = data.outputParams?.responseData?.result?.responses?.[0];
    if (!item) throw new TapoCloudError("De camera gaf geen antwoord (offline?)", "CAMERA");
    const code = item.error_code ?? 0;
    if (code !== 0) {
      const known: Record<number, string> = { [-64324]: "De privacymodus staat aan", [-64303]: "De camera draait al", [-40101]: "Dit kan deze camera niet" };
      throw new TapoCloudError(known[code] ?? `De camera weigerde de opdracht (${code})`, "CAMERA", code);
    }
    return item.result ?? {};
  }
}

const KIND: Record<string, TapoNotification["kind"]> = {
  Motion: "motion",
  PersonDetected: "person",
  PersonEnhanced: "person",
  ringEvent: "ring",
  missRingEvent: "ring",
  PetDetected: "motion",
  VehicleDetected: "motion",
  tapoCameraAreaIntrusionDetection: "person",
  tapoCameraLinecrossingDetection: "person",
};

/** Eén melding uit de app omzetten; `attachments` kan een object of een JSON-tekst zijn. */
export function parseNotification(n: Record<string, unknown>): TapoNotification[] {
  let att = n.attachments as unknown;
  if (typeof att === "string") {
    try {
      att = JSON.parse(att);
    } catch {
      att = null;
    }
  }
  const a = (att && typeof att === "object" ? att : {}) as Record<string, unknown>;
  const deviceId = typeof a.deviceId === "string" ? a.deviceId : typeof n.deviceId === "string" ? n.deviceId : null;
  const rawTime = Number(n.time ?? n.msgTime ?? 0);
  if (!deviceId || !rawTime) return [];
  const ms = rawTime < 1e12 ? rawTime * 1000 : rawTime;
  const type = String(n.msgType ?? a.msgSubType ?? "");
  return [{ deviceId, at: new Date(ms).toISOString(), kind: KIND[type] ?? "other", title: String(n.title ?? n.content ?? type).slice(0, 120) }];
}

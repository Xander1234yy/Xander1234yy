/**
 * Ziggo (Mediabox Next / Next Mini) — NIET-OFFICIËLE koppeling, op uitdrukkelijk verzoek van de gebruiker.
 * Ziggo heeft geen openbare API; dit volgt de webversie van Ziggo GO (zoals de community-projecten lghorizon en
 * homey-ziggo-next). Kan zonder aankondiging stoppen. Alleen https/wss naar Ziggo-hosts.
 */
// prod.spark.ziggogo.tv verwijst (302) hierheen; direct opvragen omdat HomeOS geen redirects volgt.
export const ZIGGO_CONFIG_URL = "https://spark-prod-nl.gnp.cloud.ziggogo.tv/nl/en/config-service/conf/web/backoffice.json";
/** Ziggo eist een cityId bij de zenderlijst; 65535 is de landelijke standaard (zelfde lijst als de Ziggo GO-webapp). */
export const ZIGGO_DEFAULT_CITY = "65535";

export class ZiggoError extends Error {
  constructor(
    message: string,
    readonly code: "UNAUTHORIZED" | "UNAVAILABLE" | "INVALID" | "FAILED",
    readonly status?: number,
  ) {
    super(message);
  }
}

export function isZiggoHost(hostname: string): boolean {
  return /(^|\.)ziggogo\.tv$/.test(hostname) || /(^|\.)horizon\.tv$/.test(hostname);
}

export interface ZiggoServices {
  auth: string;
  personalization: string;
  linear: string;
  mqtt: string;
}
export interface ZiggoSession {
  householdId: string;
  username: string;
  accessToken: string;
  refreshToken: string;
}
export interface ZiggoBox {
  deviceId: string;
  name: string;
  platform: string;
}
export interface ZiggoChannel {
  id: string;
  number: number;
  name: string;
}

function checkUrl(raw: unknown, protocols: string[]): string {
  if (typeof raw !== "string") throw new ZiggoError("Onverwachte configuratie van Ziggo", "FAILED");
  const u = new URL(raw);
  if (!protocols.includes(u.protocol) || !isZiggoHost(u.hostname)) throw new ZiggoError("Onverwacht adres in de configuratie van Ziggo", "FAILED");
  return raw.replace(/\/+$/, "");
}

export class ZiggoApi {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    if (!isZiggoHost(new URL(url).hostname)) throw new ZiggoError("Onverwacht adres", "FAILED");
    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new ZiggoError(`Ziggo niet bereikbaar: ${(e as Error).message}`, "UNAVAILABLE");
    }
    if (res.status === 401 || res.status === 403) throw new ZiggoError("Ziggo weigert de aanmelding: controleer je e-mailadres en wachtwoord", "UNAUTHORIZED");
    if (res.status === 429 || res.status >= 500) throw new ZiggoError(`Ziggo is tijdelijk niet beschikbaar (${res.status})`, "UNAVAILABLE");
    if (!res.ok) throw new ZiggoError(`Onverwacht antwoord van Ziggo (${res.status})`, "FAILED", res.status);
    return (await res.json()) as T;
  }

  async services(): Promise<ZiggoServices> {
    const c = await this.json<Record<string, { URL?: string }>>(ZIGGO_CONFIG_URL);
    return {
      auth: checkUrl(c.authorizationService?.URL, ["https:"]),
      personalization: checkUrl(c.personalizationService?.URL, ["https:"]),
      linear: checkUrl(c.linearService?.URL, ["https:"]),
      mqtt: checkUrl(c.mqttBroker?.URL, ["wss:"]),
    };
  }

  async login(s: ZiggoServices, username: string, password: string): Promise<ZiggoSession> {
    // Ziggo antwoordt op een fout wachtwoord met 400 (gecontroleerd tegen de echte dienst).
    const r = await this.json<{ householdId?: string; accessToken?: string; refreshToken?: string; username?: string }>(`${s.auth}/v1/authorization`, {
      method: "POST",
      headers: { accept: "*/*", "content-type": "application/json; charset=utf-8", "x-device-code": "web" },
      body: JSON.stringify({ username, password, stayLoggedIn: false }),
    }).catch((e: unknown) => {
      if (e instanceof ZiggoError && e.status === 400) throw new ZiggoError("Ziggo weigert de aanmelding: controleer je e-mailadres en wachtwoord", "UNAUTHORIZED", 400);
      throw e;
    });
    if (!r.householdId || !r.accessToken || !r.refreshToken) throw new ZiggoError("Ziggo gaf geen geldige aanmelding terug", "FAILED");
    return { householdId: r.householdId, accessToken: r.accessToken, refreshToken: r.refreshToken, username: r.username ?? username };
  }

  async refresh(s: ZiggoServices, session: ZiggoSession): Promise<ZiggoSession> {
    const r = await this.json<{ accessToken?: string; refreshToken?: string }>(`${s.auth}/v1/authorization/refresh`, {
      method: "POST",
      headers: { accept: "*/*", "content-type": "application/json; charset=utf-8", "x-oesp-username": session.username },
      body: JSON.stringify({ refreshToken: session.refreshToken, username: session.username }),
    });
    if (!r.accessToken) throw new ZiggoError("Ziggo vernieuwde de aanmelding niet", "UNAUTHORIZED");
    return { ...session, accessToken: r.accessToken, refreshToken: r.refreshToken ?? session.refreshToken };
  }

  private headers(session: ZiggoSession) {
    return { accept: "application/json", "x-oesp-token": session.accessToken, "x-oesp-username": session.username };
  }

  async boxes(s: ZiggoServices, session: ZiggoSession): Promise<{ boxes: ZiggoBox[]; cityId: string | null }> {
    const r = await this.json<{ assignedDevices?: { deviceId?: string; platformType?: string; settings?: { deviceFriendlyName?: string } }[]; cityId?: string | number }>(
      `${s.personalization}/v1/customer/${encodeURIComponent(session.householdId)}?with=profiles%2Cdevices`,
      { headers: this.headers(session) },
    );
    const boxes = (r.assignedDevices ?? [])
      .filter((d) => typeof d.deviceId === "string" && /^[\w.:-]{3,100}$/.test(d.deviceId))
      .map((d) => ({ deviceId: d.deviceId!, name: (d.settings?.deviceFriendlyName || "Ziggo-box").slice(0, 80), platform: (d.platformType ?? "").slice(0, 20) }));
    return { boxes, cityId: r.cityId !== undefined ? String(r.cityId) : null };
  }

  async channels(s: ZiggoServices, cityId: string | null): Promise<ZiggoChannel[]> {
    const q = new URLSearchParams({ language: "nl", productClass: "Orion-DASH" });
    q.set("cityId", cityId && /^\d{1,10}$/.test(cityId) ? cityId : ZIGGO_DEFAULT_CITY);
    const r = await this.json<{ id?: string; name?: string; logicalChannelNumber?: number }[]>(`${s.linear}/v2/channels?${q}`);
    const byNumber = new Map<number, ZiggoChannel>();
    for (const c of Array.isArray(r) ? r : []) {
      if (typeof c.id !== "string" || !/^[\w.:-]{1,100}$/.test(c.id) || typeof c.logicalChannelNumber !== "number") continue;
      byNumber.set(c.logicalChannelNumber, { id: c.id, number: c.logicalChannelNumber, name: (c.name ?? c.id).slice(0, 60) });
    }
    return [...byNumber.values()].sort((a, b) => a.number - b.number);
  }

  async mqttToken(s: ZiggoServices, session: ZiggoSession): Promise<string> {
    const r = await this.json<{ token?: string }>(`${s.auth}/v1/mqtt/token`, { headers: this.headers(session) });
    if (!r.token) throw new ZiggoError("Ziggo gaf geen verbindingssleutel", "FAILED");
    return r.token;
  }
}

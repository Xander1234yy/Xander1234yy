import { createHash, randomBytes } from "node:crypto";

/**
 * NIET-OFFICIËLE koppeling met Zonneplan. Zonneplan heeft geen openbare API; dit gebruikt dezelfde server als de
 * Zonneplan-app (app-api.zonneplan.nl), zoals de bekende open-source Home Assistant-integratie. Op uitdrukkelijk
 * verzoek van de gebruiker gebouwd, alleen-lezen. Kan zonder aankondiging stoppen met werken als Zonneplan iets wijzigt.
 *
 * Inloggen: e-mailadres → Zonneplan mailt een code → code invullen → OAuth-tokens (PKCE). Geen wachtwoord.
 */

export const ZONNEPLAN_BASE = "https://app-api.zonneplan.nl";
const APP_VERSION = "5.10.1";

export class ZonneplanError extends Error {
  constructor(
    message: string,
    readonly code: "UNAUTHORIZED" | "RATE_LIMITED" | "UNREACHABLE" | "INVALID" | "SERVER",
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
  }
}

export interface ZonneplanTokens {
  accessToken: string;
  refreshToken: string;
  /** ms sinds epoch */
  expiresAt: number;
}

export interface P1Meta {
  electricity_last_measured_at?: string;
  electricity_last_measured_delivery_value?: number;
  electricity_last_measured_production_value?: number;
  gas_last_measured_at?: string;
  dsmr_version?: string;
}

export interface ZonneplanConnectionInfo {
  connectionUuid: string;
  p1: { uuid: string; label: string; meta: P1Meta } | null;
}

export interface MeasurementGroup {
  type?: string;
  date?: string;
  totals?: { d?: number; p?: number };
  measurements?: { date: string; values?: { d?: number; p?: number } }[];
}

const headers = (token?: string) => ({
  "content-type": "application/json;charset=utf-8",
  accept: "application/json",
  "x-app-version": APP_VERSION,
  "x-app-environment": "production",
  "user-agent": "HomeOS (niet-officiele koppeling)",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(72).toString("base64url").slice(0, 96);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export class ZonneplanApi {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async send(method: "GET" | "POST", path: string, body?: unknown, token?: string, okStatuses: number[] = []): Promise<{ status: number; json: Record<string, unknown> }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${ZONNEPLAN_BASE}/${path}`, {
        method,
        headers: headers(token),
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
        redirect: "error",
      });
    } catch {
      throw new ZonneplanError("Zonneplan is niet bereikbaar", "UNREACHABLE");
    }
    const text = (await res.text()).slice(0, 3_000_000);
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* geen JSON */
    }
    if (res.ok || okStatuses.includes(res.status)) return { status: res.status, json };
    if (res.status === 401) throw new ZonneplanError("Zonneplan weigert de aanmelding. Log opnieuw in.", "UNAUTHORIZED");
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      throw new ZonneplanError("Te veel verzoeken bij Zonneplan; even wachten", "RATE_LIMITED", Number.isFinite(ra) && ra > 0 ? ra : 300);
    }
    if (res.status === 400 || res.status === 422) throw new ZonneplanError("Zonneplan accepteert dit niet (verkeerde of verlopen code?)", "INVALID");
    throw new ZonneplanError(`Zonneplan gaf status ${res.status}`, "SERVER");
  }

  /** Stap 1: Zonneplan mailt een code. Geeft de sessie terug die bij stap 2 nodig is. */
  async requestCode(email: string): Promise<{ authSession: string; verifier: string }> {
    const { verifier, challenge } = pkcePair();
    const { json } = await this.send(
      "POST",
      "oauth/authorize-challenge",
      { response_type: "code", email, code_challenge: challenge, code_challenge_method: "S256", source_name: "HomeOS" },
      undefined,
      [403], // 403 met otp_required is hier het verwachte antwoord
    );
    if (!json.otp_required || typeof json.auth_session !== "string") throw new ZonneplanError("Onverwacht antwoord van Zonneplan bij het aanvragen van een code", "SERVER");
    return { authSession: json.auth_session, verifier };
  }

  /** Stap 2: code uit de e-mail → tokens. */
  async submitCode(authSession: string, code: string, verifier: string): Promise<ZonneplanTokens> {
    const { json } = await this.send("POST", "oauth/authorize-challenge", { auth_session: authSession, otp: code });
    const authorizationCode = json.authorization_code;
    if (typeof authorizationCode !== "string") throw new ZonneplanError("De code is niet geaccepteerd", "INVALID");
    return this.token({ grant_type: "authorization_code", code: authorizationCode, code_verifier: verifier });
  }

  refresh(refreshToken: string): Promise<ZonneplanTokens> {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  private async token(grant: Record<string, string>): Promise<ZonneplanTokens> {
    const { json } = await this.send("POST", "oauth/token", grant);
    const access = json.access_token;
    const refresh = json.refresh_token;
    if (typeof access !== "string" || typeof refresh !== "string") throw new ZonneplanError("Zonneplan gaf geen geldige tokens", "SERVER");
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
    return { accessToken: access, refreshToken: refresh, expiresAt: Date.now() + expiresIn * 1000 };
  }

  /** Aansluitingen met een Zonneplan Connect (p1_installation). */
  async connections(token: string): Promise<ZonneplanConnectionInfo[]> {
    const { json } = await this.send("GET", "user-accounts/me", undefined, token);
    const data = (json.data ?? {}) as { address_groups?: { connections?: { uuid?: string; contracts?: { uuid?: string; type?: string; label?: string; meta?: P1Meta }[] }[] }[] };
    const out: ZonneplanConnectionInfo[] = [];
    for (const g of data.address_groups ?? []) {
      for (const c of g.connections ?? []) {
        if (typeof c.uuid !== "string") continue;
        const p1 = (c.contracts ?? []).find((k) => k.type === "p1_installation");
        out.push({ connectionUuid: c.uuid, p1: p1 && typeof p1.uuid === "string" ? { uuid: p1.uuid, label: String(p1.label ?? "Zonneplan Connect").slice(0, 80), meta: p1.meta ?? {} } : null });
      }
    }
    return out;
  }

  /** Totalen stroom van het net (d) en teruglevering (p), in Wh. Groepen: live/hours = vandaag, days = maand, months = jaar. */
  async electricity(token: string, connectionUuid: string): Promise<MeasurementGroup[]> {
    if (!/^[0-9a-f-]{36}$/i.test(connectionUuid)) throw new ZonneplanError("Ongeldige aansluiting", "INVALID");
    const { json } = await this.send("GET", `connections/${connectionUuid}/electricity-delivered`, undefined, token);
    const data = (json.data ?? {}) as { measurement_groups?: MeasurementGroup[] };
    return Array.isArray(data.measurement_groups) ? data.measurement_groups : [];
  }
}

import { CloudApiError } from "../cloud/budget";

/** Officiële Daikin Onecta OIDC-endpoints (Daikin Developer Portal). */
export const DAIKIN_AUTHORIZE_URL = "https://idp.onecta.daikineurope.com/v1/oidc/authorize";
export const DAIKIN_TOKEN_URL = "https://idp.onecta.daikineurope.com/v1/oidc/token";
export const DAIKIN_API_URL = "https://api.onecta.daikineurope.com";
export const DAIKIN_SCOPE = "openid onecta:basic.integration";

export interface DaikinTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** Daikin weigert localhost/127.0.0.1 en vereist https als redirect-URI. */
export function validateRedirectUri(uri: string): string | null {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return "Ongeldige URL";
  }
  if (u.protocol !== "https:") return "De redirect-URI moet met https:// beginnen (eis van Daikin)";
  if (["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return "Daikin accepteert localhost/127.0.0.1 niet als redirect-URI";
  if (u.hash) return "Geen #-fragment in de redirect-URI";
  return null;
}

export function authorizeUrl(o: { clientId: string; redirectUri: string; state: string }): string {
  const u = new URL(DAIKIN_AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("scope", DAIKIN_SCOPE);
  u.searchParams.set("state", o.state);
  return u.toString();
}

/** Haalt code en state uit de URL waar Daikin naartoe doorstuurde. */
export function parseCallbackUrl(callbackUrl: string): { code: string; state: string } | { error: string } {
  let u: URL;
  try {
    u = new URL(callbackUrl.trim());
  } catch {
    return { error: "Plak de volledige adresregel (begint met https://)" };
  }
  const err = u.searchParams.get("error");
  if (err) return { error: `Daikin meldde: ${u.searchParams.get("error_description") ?? err}` };
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  if (!code || !state) return { error: "In deze URL staat geen autorisatiecode" };
  return { code, state };
}

export async function tokenRequest(fetchImpl: typeof fetch, body: Record<string, string>, now = Date.now()): Promise<DaikinTokens> {
  let res: Response;
  try {
    res = await fetchImpl(DAIKIN_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new CloudApiError("Daikin-inlogdienst niet bereikbaar", "network");
  }
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    const kind = res.status === 400 || res.status === 401 ? "auth" : "server";
    throw new CloudApiError(`Daikin weigerde de aanmelding${json.error_description ? `: ${json.error_description}` : json.error ? ` (${json.error})` : ""}`, kind);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? body.refresh_token ?? "",
    expiresAt: now + Math.max(60, (json.expires_in ?? 3600) - 60) * 1000,
  };
}

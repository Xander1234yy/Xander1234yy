import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Toegangscode voor de lokale modus (zonder accounts) als HomeOS van buiten de laptop wordt geopend, bijvoorbeeld via
 * Tailscale op je telefoon. Op de laptop zelf (127.0.0.1) is geen code nodig. De code staat alleen in de omgeving van
 * de webapp (HOMEOS_ACCESS_CODE); in de browser staat een httpOnly-cookie met een HMAC, nooit de code zelf.
 */

export const ACCESS_COOKIE = "homeos_access";
export const ACCESS_MAX_AGE = 30 * 24 * 3600;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function accessCode(): string | null {
  const c = process.env.HOMEOS_ACCESS_CODE?.trim();
  return c && c.length >= 8 ? c : null;
}

const LOOPBACK_IP = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
const hostOnly = (h: string) => h.trim().toLowerCase().replace(/:\d+$/, "");

/**
 * Alleen een direct verzoek op de laptop zelf telt als lokaal. Next.js vult zelf X-Forwarded-* in met het adres van de
 * verbinding; via Tailscale of een tunnel staat daar het adres van de telefoon (bijv. 100.x.y.z). De webapp luistert
 * alleen op 127.0.0.1, dus van buiten kan alleen via zo'n proxy.
 */
export function isLoopbackRequest(headers: Headers): boolean {
  if (!LOOPBACK.has(hostOnly(headers.get("host") ?? ""))) return false;
  const fwdHost = headers.get("x-forwarded-host");
  if (fwdHost && !LOOPBACK.has(hostOnly(fwdHost))) return false;
  const chain = [headers.get("x-forwarded-for"), headers.get("x-real-ip"), headers.get("cf-connecting-ip")]
    .filter((v): v is string => !!v)
    .flatMap((v) => v.split(","))
    .map((v) => v.trim().replace(/^\[|\]$/g, ""));
  if (chain.some((ip) => !LOOPBACK_IP.test(ip))) return false;
  if (headers.has("tailscale-user-login") || headers.has("forwarded")) return false;
  return true;
}

export function accessToken(code: string): string {
  return createHmac("sha256", code).update("homeos-local-access-v1").digest("base64url");
}

export function validAccessCookie(value: string | undefined): boolean {
  const code = accessCode();
  if (!code || !value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(accessToken(code));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function codeMatches(input: string): boolean {
  const code = accessCode();
  if (!code) return false;
  const a = Buffer.from(accessToken(input));
  const b = Buffer.from(accessToken(code));
  return timingSafeEqual(a, b);
}

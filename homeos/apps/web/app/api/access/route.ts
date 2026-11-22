import { z } from "zod";
import { isSameOrigin, jsonError } from "@/lib/server/allowlist";
import { rateLimit } from "@/lib/server/authz";
import { ACCESS_COOKIE, ACCESS_MAX_AGE, accessCode, accessToken, codeMatches } from "@/lib/server/local-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Toegangscode controleren (lokale modus, van buiten de laptop). Max. 5 pogingen per minuut per adres. */
export async function POST(req: Request) {
  if (!isSameOrigin(req.headers)) return jsonError(403, "CSRF", "Verzoek van onbekende herkomst geweigerd");
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "onbekend";
  if (!rateLimit(`access:${ip}`, 5)) return jsonError(429, "RATE_LIMITED", "Te veel pogingen. Wacht een minuut.");
  if (!accessCode()) return jsonError(403, "NOT_CONFIGURED", "Er is geen toegangscode ingesteld op de laptop. Zie de handleiding 'Toegang vanaf je telefoon'.");
  const parsed = z.object({ code: z.string().min(1).max(200) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success || !codeMatches(parsed.data.code)) return jsonError(401, "WRONG_CODE", "Onjuiste toegangscode");
  const res = Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  res.headers.append("set-cookie", `${ACCESS_COOKIE}=${accessToken(accessCode()!)}; Path=/; Max-Age=${ACCESS_MAX_AGE}; HttpOnly; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  return res;
}

/** Afmelden op dit apparaat. */
export async function DELETE(req: Request) {
  if (!isSameOrigin(req.headers)) return jsonError(403, "CSRF", "Verzoek van onbekende herkomst geweigerd");
  const res = Response.json({ ok: true });
  res.headers.append("set-cookie", `${ACCESS_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`);
  return res;
}

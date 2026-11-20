import type { NextRequest } from "next/server";
import { permissionForConnectorRoute } from "@homeos/shared";
import { ConnectorUnavailableError, connectorFetch } from "@/lib/server/connector-client";
import { isAllowed, isSameOrigin, jsonError } from "@/lib/server/allowlist";
import { assertConnectorLinked, authorize, rateLimit, writeAudit } from "@/lib/server/authz";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 32 * 1024;

/**
 * Gecontroleerde proxy van de webapp naar de lokale connector:
 * 1. alleen endpoints uit de allowlist
 * 2. wijzigende verzoeken alleen vanaf dezelfde origin (CSRF)
 * 3. cloudmodus: ingelogd, lid van het huishouden, juiste rol, en de gekoppelde connector
 * 4. rate limiting per gebruiker en een auditregel in Supabase
 * De connector valideert iedere opdracht daarna nogmaals (zod + capabilities + noodstop).
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.map((p) => encodeURIComponent(decodeURIComponent(p))).join("/");
  const method = req.method.toUpperCase();
  const permission = permissionForConnectorRoute(method, joined);
  if (!isAllowed(method, joined) || !permission) return jsonError(404, "NOT_ALLOWED", "Endpoint niet beschikbaar");
  const mutating = method !== "GET";
  if (mutating && !isSameOrigin(req.headers)) return jsonError(403, "CSRF", "Verzoek van onbekende herkomst geweigerd");

  const auth = await authorize(permission);
  if (!auth.ok) return auth.response;
  const a = auth.ctx;
  if (a.mode === "cloud" && permission === "manage_rooms") {
    return jsonError(409, "ROOMS_IN_CLOUD", "Kamers worden beheerd via HomeOS (Supabase)");
  }
  const notLinked = await assertConnectorLinked(a);
  if (notLinked) return notLinked;
  if (mutating && !rateLimit(`${a.userId ?? "local"}:${permission}`, permission === "control" ? 60 : 30)) {
    return jsonError(429, "RATE_LIMITED", "Te veel verzoeken, probeer het zo opnieuw");
  }

  let body: string | undefined;
  if (mutating && method !== "DELETE") {
    body = await req.text();
    if (body.length > MAX_BODY) return jsonError(413, "TOO_LARGE", "Verzoek te groot");
  }

  try {
    // Matter-koppelen (apparaat zoeken + PASE/CASE) kan enkele minuten duren.
    const slow = /^v1\/integrations\/matter\/commission$/.test(joined);
    const res = await connectorFetch(`/${joined}${req.nextUrl.search}`, { method, ...(body ? { body } : {}), ...(slow ? { signal: AbortSignal.timeout(180_000) } : {}) });
    const text = await res.text();
    if (mutating) {
      let source: "user" | "jarvis" = "user";
      let details: Record<string, unknown> = {};
      try {
        const parsed = body ? (JSON.parse(body) as { source?: string; command?: unknown }) : {};
        if (parsed.source === "jarvis") source = "jarvis";
        if (parsed.command) details = { command: parsed.command };
      } catch {
        /* body is al door de connector gevalideerd */
      }
      await writeAudit(a, { action: `connector.${method.toLowerCase()}`, target: joined.slice(0, 200), ok: res.ok, source, details: { ...details, status: res.status } });
    }
    return new Response(text, { status: res.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof ConnectorUnavailableError) return jsonError(503, `CONNECTOR_${err.reason.toUpperCase()}`, err.message);
    return jsonError(500, "INTERNAL", "Interne fout");
  }
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE, handle as PUT };

import type { NextRequest } from "next/server";
import { ConnectorUnavailableError, connectorFetch } from "@/lib/server/connector-client";
import { isAllowed, isSameOrigin, jsonError } from "@/lib/server/allowlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 32 * 1024;

/**
 * Gecontroleerde proxy van de webapp naar de lokale connector.
 * - alleen endpoints uit de allowlist
 * - wijzigende verzoeken alleen vanaf dezelfde origin (CSRF)
 * - het connector-token blijft op de server
 * De connector valideert iedere opdracht daarna nogmaals (zod + capabilities + noodstop).
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.map((p) => encodeURIComponent(decodeURIComponent(p))).join("/");
  const method = req.method.toUpperCase();
  if (!isAllowed(method, joined)) return jsonError(404, "NOT_ALLOWED", "Endpoint niet beschikbaar");
  if (method !== "GET" && !isSameOrigin(req.headers)) return jsonError(403, "CSRF", "Verzoek van onbekende herkomst geweigerd");

  let body: string | undefined;
  if (method !== "GET" && method !== "DELETE") {
    body = await req.text();
    if (body.length > MAX_BODY) return jsonError(413, "TOO_LARGE", "Verzoek te groot");
  }

  try {
    const search = req.nextUrl.search;
    const res = await connectorFetch(`/${joined}${search}`, { method, ...(body ? { body } : {}) });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    if (err instanceof ConnectorUnavailableError) return jsonError(503, `CONNECTOR_${err.reason.toUpperCase()}`, err.message);
    return jsonError(500, "INTERNAL", "Interne fout");
  }
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };

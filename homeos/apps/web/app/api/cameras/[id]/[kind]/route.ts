import type { NextRequest } from "next/server";
import { ConnectorUnavailableError, connectorFetch } from "@/lib/server/connector-client";
import { jsonError } from "@/lib/server/allowlist";
import { assertConnectorLinked, authorize, rateLimit, writeAudit } from "@/lib/server/authz";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ID = /^tapo-[0-9a-f]{6}:camera$/;

/**
 * Camerabeeld (momentopname of live MJPEG) van de lokale connector naar de browser.
 * Privacygevoelig: alleen leden en hoger (view_cameras), alleen de eigen gekoppelde connector,
 * rate limiting, en iedere live-weergave komt in de auditlog. Er wordt niets opgeslagen of gecachet.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; kind: string }> }) {
  const { id: raw, kind } = await ctx.params;
  const id = decodeURIComponent(raw);
  if (!ID.test(id) || (kind !== "snapshot" && kind !== "stream")) return jsonError(404, "NOT_FOUND", "Onbekende camera");
  const auth = await authorize("view_cameras");
  if (!auth.ok) return auth.response;
  const notLinked = await assertConnectorLinked(auth.ctx);
  if (notLinked) return notLinked;
  const user = auth.ctx.userId ?? "local";
  if (!rateLimit(`camera:${kind}:${user}`, kind === "stream" ? 20 : 90)) return jsonError(429, "RATE_LIMITED", "Te veel verzoeken, probeer het zo opnieuw");

  try {
    const res = await connectorFetch(`/v1/cameras/${encodeURIComponent(id)}/${kind}`, {
      signal: kind === "stream" ? req.signal : AbortSignal.timeout(20_000),
    });
    if (kind === "stream") await writeAudit(auth.ctx, { action: "camera.view", target: id, ok: res.ok, details: { status: res.status } });
    if (!res.ok || !res.body) {
      return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }
    return new Response(res.body, {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/octet-stream",
        "cache-control": "no-store, private",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof ConnectorUnavailableError) return jsonError(503, `CONNECTOR_${err.reason.toUpperCase()}`, err.message);
    return jsonError(500, "INTERNAL", "Interne fout");
  }
}

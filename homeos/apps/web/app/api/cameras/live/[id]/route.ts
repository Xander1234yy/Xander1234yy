import type { NextRequest } from "next/server";
import { ConnectorUnavailableError, connectorFetch } from "@/lib/server/connector-client";
import { jsonError } from "@/lib/server/allowlist";
import { assertConnectorLinked, authorize, rateLimit, writeAudit } from "@/lib/server/authz";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Live beeld duurt maximaal 4 minuten per keer (de connector stopt dan zelf); iets marge voor het opstarten. */
export const maxDuration = 300;

const ID = /^tapocloud:[0-9A-Za-z]{8,80}$/;

/**
 * Live camerabeeld via de TP-Link-cloud (niet-officieel) als MPEG-TS naar de browser. Privacygevoelig: alleen leden en
 * hoger (view_cameras), rate limiting, iedere weergave in de auditlog, niets opgeslagen of gecachet.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await ctx.params).id);
  if (!ID.test(id)) return jsonError(404, "NOT_FOUND", "Onbekende camera");
  const auth = await authorize("view_cameras");
  if (!auth.ok) return auth.response;
  const notLinked = await assertConnectorLinked(auth.ctx);
  if (notLinked) return notLinked;
  if (!rateLimit(`camera:live:${auth.ctx.userId ?? "local"}`, 10)) return jsonError(429, "RATE_LIMITED", "Te veel verzoeken, probeer het zo opnieuw");
  const path = `/v1/cameras/tapocloud/${encodeURIComponent(id.slice("tapocloud:".length))}/live`;
  try {
    const { cloudRuntimeEnabled, cloudConnectorStream } = await import("@/lib/cloud/runtime");
    let res: Response;
    if (cloudRuntimeEnabled()) {
      const { getSession } = await import("@/lib/session");
      const s = await getSession();
      if (!s.household) return jsonError(400, "NO_HOUSEHOLD", "Geen huishouden gekozen");
      res = await cloudConnectorStream(s.household.id, path, req.signal);
    } else {
      res = await connectorFetch(path, { signal: req.signal });
    }
    await writeAudit(auth.ctx, { action: "camera.view", target: id, ok: res.ok, details: { status: res.status, via: "tplink-relay" } });
    if (!res.ok || !res.body) {
      return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }
    const codec = res.headers.get("x-audio-codec");
    const rate = res.headers.get("x-audio-rate");
    return new Response(res.body, {
      status: 200,
      headers: {
        "content-type": "video/mp2t",
        "cache-control": "no-store, private",
        "x-content-type-options": "nosniff",
        ...(codec === "alaw" || codec === "mulaw" ? { "x-audio-codec": codec } : {}),
        ...(rate && /^\d{4,5}$/.test(rate) ? { "x-audio-rate": rate } : {}),
      },
    });
  } catch (err) {
    if (err instanceof ConnectorUnavailableError) return jsonError(503, `CONNECTOR_${err.reason.toUpperCase()}`, err.message);
    return jsonError(500, "INTERNAL", "Interne fout");
  }
}

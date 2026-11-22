import type { NextRequest } from "next/server";
import { connectorFetch } from "@/lib/server/connector-client";
import { authorize, writeAudit } from "@/lib/server/authz";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Terugkoppeling van de Hue-cloud na inloggen (callback-URL van je Hue-app). Alleen voor beheerders; de state wordt
 * in de connector gecontroleerd. Daarna terug naar Instellingen met het resultaat.
 */
export async function GET(req: NextRequest) {
  const back = (q: string) => Response.redirect(new URL(`/instellingen?hue=${q}`, req.nextUrl.origin), 303);
  const auth = await authorize("manage_devices");
  if (!auth.ok) return back("geen-rechten");
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state || code.length > 500 || state.length > 200) return back("geweigerd");
  try {
    const res = await connectorFetch("/v1/integrations/huecloud/complete", { method: "POST", body: JSON.stringify({ code, state }), signal: AbortSignal.timeout(30_000) });
    await writeAudit(auth.ctx, { action: "integration.huecloud.link", ok: res.ok, details: { status: res.status } });
    return back(res.ok ? "gekoppeld" : "mislukt");
  } catch {
    return back("mislukt");
  }
}

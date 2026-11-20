import { CONNECTOR_URL } from "@/lib/server/connector-client";

export const dynamic = "force-dynamic";

/** Bereikbaarheid van de HomeOS cloud/web-API zelf, plus een snelle connectorcheck. */
export async function GET() {
  let connector: boolean;
  try {
    const r = await fetch(`${CONNECTOR_URL}/health`, { cache: "no-store", signal: AbortSignal.timeout(2_000) });
    connector = r.ok;
  } catch {
    connector = false;
  }
  return Response.json({ ok: true, connector, at: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}

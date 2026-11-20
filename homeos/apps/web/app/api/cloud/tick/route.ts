import { timingSafeEqual } from "node:crypto";
import { cloudRuntimeEnabled, withCloudConnector } from "@/lib/cloud/runtime";
import { cloudHouseholds, pruneLogs } from "@/lib/cloud/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Geplande taak van de cloudmodus (elke minuut, via Supabase pg_cron of een externe cron). Per huishouden:
 * gegevens verversen als ze verouderd zijn, automatiseringen evalueren, pushmeldingen versturen.
 * Beveiligd met een eigen geheim (HOMEOS_CRON_SECRET); voert nooit inhaalacties uit.
 */
export async function POST(req: Request) {
  if (!cloudRuntimeEnabled()) return Response.json({ error: { code: "NOT_CLOUD", message: "Cloudmodus staat uit" } }, { status: 404 });
  const secret = process.env.HOMEOS_CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (secret.length < 32 || a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Geen toegang" } }, { status: 401 });
  }
  const started = Date.now();
  const results: { household: string; ok: boolean; error?: string }[] = [];
  for (const household of await cloudHouseholds()) {
    if (Date.now() - started > 45_000) break; // binnen de tijdslimiet blijven; volgende minuut verder
    try {
      await withCloudConnector(household, async (c) => {
        await c.automations.tick();
      });
      if (new Date().getMinutes() === 0) await pruneLogs(household);
      results.push({ household, ok: true });
    } catch (err) {
      results.push({ household, ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "fout" });
    }
  }
  return Response.json({ ok: true, households: results.length, failed: results.filter((r) => !r.ok).length, ms: Date.now() - started }, { headers: { "cache-control": "no-store" } });
}

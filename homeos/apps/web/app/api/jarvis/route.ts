import { z } from "zod";
import { EnergySummarySchema, SnapshotSchema, type EnergySummary, type Snapshot } from "@homeos/shared";
import { connectorFetch } from "@/lib/server/connector-client";
import { isSameOrigin, jsonError } from "@/lib/server/allowlist";
import { handleLocal } from "@/lib/jarvis/local-intents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({ message: z.string().trim().min(1).max(500) });

/**
 * Jarvis interpreteert alleen en doet voorstellen. Uitvoeren gebeurt pas na bevestiging,
 * via het normale (gecontroleerde) opdracht-endpoint met bron "jarvis".
 * Fase 6 voegt hier een AI-provider aan toe; deze lokale fallback blijft bestaan.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req.headers)) return jsonError(403, "CSRF", "Verzoek van onbekende herkomst geweigerd");
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "INVALID", "Bericht ontbreekt of is te lang");

  let snapshot: Snapshot | null = null;
  let energy: EnergySummary | null = null;
  let connectorOnline = false;
  try {
    const [s, e] = await Promise.all([connectorFetch("/v1/snapshot"), connectorFetch("/v1/energy/summary")]);
    if (s.ok) {
      snapshot = SnapshotSchema.parse(await s.json());
      connectorOnline = true;
    }
    if (e.ok) energy = EnergySummarySchema.parse(await e.json());
  } catch {
    connectorOnline = false;
  }

  return Response.json(handleLocal(parsed.data.message, { snapshot, energy, connectorOnline }), {
    headers: { "cache-control": "no-store" },
  });
}

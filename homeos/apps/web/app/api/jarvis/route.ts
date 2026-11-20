import { z } from "zod";
import { EnergySummarySchema, SnapshotSchema, type EnergySummary, type Snapshot } from "@homeos/shared";
import { connectorFetch } from "@/lib/server/connector-client";
import { isSameOrigin, jsonError } from "@/lib/server/allowlist";
import { handleLocal, type FamilyContext } from "@/lib/jarvis/local-intents";
import { getFamilySummary } from "@/lib/actions/summary";
import { can } from "@homeos/shared";
import { assertConnectorLinked, authorize, rateLimit } from "@/lib/server/authz";

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
  const auth = await authorize("view");
  if (!auth.ok) return auth.response;
  if (!rateLimit(`jarvis:${auth.ctx.userId ?? "local"}`, 30)) return jsonError(429, "RATE_LIMITED", "Even rustig aan, probeer het zo opnieuw");
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "INVALID", "Bericht ontbreekt of is te lang");

  let snapshot: Snapshot | null = null;
  let energy: EnergySummary | null = null;
  let connectorOnline = false;
  const linkProblem = await assertConnectorLinked(auth.ctx);
  try {
    if (linkProblem) throw new Error("niet gekoppeld");
    const [s, e] = await Promise.all([connectorFetch("/v1/snapshot"), connectorFetch("/v1/energy/summary")]);
    if (s.ok) {
      snapshot = SnapshotSchema.parse(await s.json());
      connectorOnline = true;
    }
    if (e.ok) energy = EnergySummarySchema.parse(await e.json());
  } catch {
    connectorOnline = false;
  }

  let family: FamilyContext | undefined;
  if (auth.ctx.mode === "cloud") {
    const summary = await getFamilySummary();
    if (summary.ok && summary.value) family = { ...summary.value, canWrite: can(auth.ctx.role, "family_write") };
  }

  return Response.json(handleLocal(parsed.data.message, { snapshot, energy, connectorOnline, ...(family ? { family } : {}) }), {
    headers: { "cache-control": "no-store" },
  });
}

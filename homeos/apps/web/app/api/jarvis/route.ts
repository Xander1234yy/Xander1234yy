import { z } from "zod";
import { EnergyHistorySchema, EnergySummarySchema, SnapshotSchema, can, type EnergyHistory, type EnergySummary, type Snapshot } from "@homeos/shared";
import { getProvider, type AutomationInfo, type FamilyContext } from "@homeos/jarvis";
import { connectorFetch } from "@/lib/server/connector-client";
import { isSameOrigin, jsonError } from "@/lib/server/allowlist";
import { getFamilySummary } from "@/lib/actions/summary";
import { assertConnectorLinked, authorize, rateLimit } from "@/lib/server/authz";
import { appendExchange, clearConversations, loadLatestConversation } from "@/lib/jarvis/history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  message: z.string().trim().min(1).max(500),
  memory: z
    .object({ deviceIds: z.array(z.string().max(200)).max(50), roomId: z.string().max(100).nullable() })
    .nullish(),
  conversationId: z.uuid().nullish(),
});
const AutomationsSchema = z.object({ automations: z.array(z.object({ id: z.string(), name: z.string(), enabled: z.boolean() }).loose()) });
const noStore = { "cache-control": "no-store" };

/**
 * Jarvis interpreteert alleen en doet voorstellen. Uitvoeren gebeurt pas na bevestiging,
 * via het normale (gecontroleerde) opdracht-endpoint met bron "jarvis".
 * Provider: alleen de lokale Jarvis (geen AI-dienst, geen internet nodig).
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
  let energyWeek: EnergyHistory | null = null;
  let automations: AutomationInfo[] = [];
  let connectorOnline = false;
  const linkProblem = await assertConnectorLinked(auth.ctx);
  try {
    if (linkProblem) throw new Error("niet gekoppeld");
    const [s, e, w, a] = await Promise.all([
      connectorFetch("/v1/snapshot"),
      connectorFetch("/v1/energy/summary"),
      connectorFetch("/v1/energy/history?range=week").catch(() => null),
      connectorFetch("/v1/automations").catch(() => null),
    ]);
    if (s.ok) {
      snapshot = SnapshotSchema.parse(await s.json());
      connectorOnline = true;
    }
    if (e.ok) energy = EnergySummarySchema.parse(await e.json());
    if (w?.ok) energyWeek = EnergyHistorySchema.safeParse(await w.json()).data ?? null;
    if (a?.ok) automations = (AutomationsSchema.safeParse(await a.json()).data?.automations ?? []).map(({ id, name, enabled }) => ({ id, name, enabled }));
  } catch {
    connectorOnline = false;
  }

  let family: FamilyContext | undefined;
  if (auth.ctx.mode === "cloud") {
    const summary = await getFamilySummary();
    if (summary.ok && summary.value) family = { ...summary.value, canWrite: can(auth.ctx.role, "family_write") };
  }
  const canControl = auth.ctx.mode === "local" || can(auth.ctx.role, "control");
  const canManageAutomations = auth.ctx.mode === "local" || can(auth.ctx.role, "manage_automations");

  const provider = getProvider("local");
  const reply = await provider.respond(parsed.data.message, {
    snapshot,
    energy,
    energyWeek,
    connectorOnline,
    automations,
    memory: parsed.data.memory ?? null,
    canControl,
    canManageAutomations,
    ...(family ? { family } : {}),
  });
  const conversationId = await appendExchange(auth.ctx, parsed.data.conversationId ?? null, parsed.data.message, reply);
  return Response.json({ ...reply, conversationId }, { headers: noStore });
}

/** Laatste gesprek (cloudmodus). In de lokale modus bewaart de browser het gesprek zelf. */
export async function GET() {
  const auth = await authorize("view");
  if (!auth.ok) return auth.response;
  const latest = await loadLatestConversation(auth.ctx);
  return Response.json({ mode: auth.ctx.mode, provider: { id: "local", name: "Lokale Jarvis", requiresNetwork: false }, ...latest }, { headers: noStore });
}

/** Wist de eigen gespreksgeschiedenis (cloudmodus). */
export async function DELETE(req: Request) {
  if (!isSameOrigin(req.headers)) return jsonError(403, "CSRF", "Verzoek van onbekende herkomst geweigerd");
  const auth = await authorize("view");
  if (!auth.ok) return auth.response;
  if (!(await clearConversations(auth.ctx))) return jsonError(500, "FAILED", "Wissen mislukt");
  return Response.json({ ok: true }, { headers: noStore });
}

import "server-only";
import { cloudRuntimeEnabled } from "@/lib/cloud/runtime";
import { can, type HouseholdRole, type Permission } from "@homeos/shared";
import { getSession } from "@/lib/session";
import { authMode, localModeAllowed } from "@/lib/supabase/config";
import { createSupabaseServer } from "@/lib/supabase/server";
import { connectorFetch, ConnectorUnavailableError } from "./connector-client";
import { jsonError } from "./allowlist";

export interface AuthzContext {
  mode: "cloud" | "local";
  userId: string | null;
  householdId: string | null;
  role: HouseholdRole | null;
}

type Result = { ok: true; ctx: AuthzContext } | { ok: false; response: Response };

/** Controleert sessie, lidmaatschap en rol voor een API-verzoek. */
export async function authorize(permission: Permission): Promise<Result> {
  if (authMode() === "local") {
    if (!localModeAllowed()) return { ok: false, response: jsonError(503, "AUTH_NOT_CONFIGURED", "Supabase is niet geconfigureerd") };
    return { ok: true, ctx: { mode: "local", userId: null, householdId: null, role: null } };
  }
  const s = await getSession();
  if (!s.user) return { ok: false, response: jsonError(401, "UNAUTHENTICATED", "Log opnieuw in") };
  if (!s.household) return { ok: false, response: jsonError(403, "NO_HOUSEHOLD", "Maak eerst een huishouden aan") };
  if (!can(s.household.role, permission)) {
    return { ok: false, response: jsonError(403, "FORBIDDEN", "Je rol heeft hier geen toestemming voor") };
  }
  return { ok: true, ctx: { mode: "cloud", userId: s.user.id, householdId: s.household.id, role: s.household.role } };
}

let identityCache: { connectorId: string; version: string; at: number } | null = null;

/** Identiteit van de bereikbare connector (30 s gecachet). */
export async function connectorIdentity(force = false): Promise<{ connectorId: string; version: string }> {
  if (!force && identityCache && Date.now() - identityCache.at < 30_000) return identityCache;
  const res = await connectorFetch("/v1/identity");
  if (!res.ok) throw new ConnectorUnavailableError("Connector-identiteit onbekend", "unreachable");
  const body = (await res.json()) as { connectorId: string; version: string };
  identityCache = { ...body, at: Date.now() };
  return body;
}

/** In cloudmodus mag een huishouden alleen de connector gebruiken die eraan gekoppeld is. */
export async function assertConnectorLinked(ctx: AuthzContext): Promise<Response | null> {
  if (ctx.mode === "local") return null;
  // Cloudmodus: ieder huishouden heeft zijn eigen connector in de cloud; er is niets te koppelen.
  if (cloudRuntimeEnabled()) return null;
  const supabase = await createSupabaseServer();
  const { data } = await supabase.from("connector_status").select("connector_id").eq("household_id", ctx.householdId!).maybeSingle();
  if (!data) return jsonError(409, "CONNECTOR_NOT_LINKED", "Koppel eerst de connector aan dit huishouden (Instellingen)");
  try {
    const id = await connectorIdentity();
    if (id.connectorId !== data.connector_id) {
      return jsonError(409, "CONNECTOR_MISMATCH", "De bereikbare connector hoort niet bij dit huishouden");
    }
  } catch (err) {
    if (err instanceof ConnectorUnavailableError) return jsonError(503, `CONNECTOR_${err.reason.toUpperCase()}`, err.message);
    throw err;
  }
  return null;
}

/** Legt een actie vast in het auditlog van het huishouden (cloudmodus). Fouten hierbij blokkeren niets. */
export async function writeAudit(ctx: AuthzContext, entry: { action: string; target?: string | null; ok: boolean; source?: "user" | "jarvis"; details?: Record<string, unknown> }) {
  if (ctx.mode !== "cloud" || !ctx.householdId) return;
  try {
    const supabase = await createSupabaseServer();
    await supabase.from("audit_logs").insert({
      household_id: ctx.householdId,
      action: entry.action.slice(0, 80),
      source: entry.source ?? "user",
      target: entry.target?.slice(0, 200) ?? null,
      ok: entry.ok,
      details: entry.details ?? {},
    });
  } catch {
    /* audit is best-effort aan de webkant; de connector houdt een eigen auditlog bij */
  }
}

const buckets = new Map<string, { tokens: number; at: number }>();
/** Rate limit per gebruiker (of per proces in lokale modus). */
export function rateLimit(key: string, perMinute: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 5_000) buckets.clear();
  return true;
}

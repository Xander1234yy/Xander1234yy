import "server-only";
import { can, type Permission } from "@homeos/shared";
import { friendlyDbError } from "@homeos/database";
import { getSession } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { ok: true; value?: T } | { ok: false; error: string };

type Ctx = { supabase: Awaited<ReturnType<typeof createSupabaseServer>>; householdId: string; userId: string };

/** Voert een actie uit binnen het actieve huishouden, na controle van sessie en rol. RLS controleert opnieuw. */
export async function inHousehold<T>(permission: Permission, fn: (ctx: Ctx) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const s = await getSession();
  if (s.mode !== "cloud") return { ok: false, error: "Hiervoor is een HomeOS-account (Supabase) nodig." };
  if (!s.user) return { ok: false, error: "Log opnieuw in." };
  if (!s.household) return { ok: false, error: "Geen huishouden geselecteerd." };
  if (!can(s.household.role, permission)) return { ok: false, error: "Je rol heeft hier geen toestemming voor." };
  try {
    return await fn({ supabase: await createSupabaseServer(), householdId: s.household.id, userId: s.user.id });
  } catch (err) {
    return { ok: false, error: friendlyDbError(err as { code?: string; message?: string }) };
  }
}

export function fail(error: { code?: string; message?: string } | null): ActionResult<never> {
  return { ok: false, error: friendlyDbError(error) };
}

export function invalid(issues: { message: string }[]): ActionResult<never> {
  return { ok: false, error: issues[0]?.message ?? "Ongeldige invoer" };
}

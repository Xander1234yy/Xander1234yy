import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { HouseholdRole } from "@homeos/shared";
import type { HouseholdRow } from "@homeos/database";
import { authMode, HOUSEHOLD_COOKIE } from "./supabase/config";
import { createSupabaseServer } from "./supabase/server";

export interface SessionInfo {
  mode: "cloud" | "local";
  user: { id: string; email: string; displayName: string } | null;
  households: (HouseholdRow & { role: HouseholdRole })[];
  household: (HouseholdRow & { role: HouseholdRole }) | null;
}

/** Huidige gebruiker en actief huishouden (één keer per request). */
export const getSession = cache(async (): Promise<SessionInfo> => {
  if (authMode() === "local") return { mode: "local", user: null, households: [], household: null };
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { mode: "cloud", user: null, households: [], household: null };

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", data.user.id).maybeSingle(),
    supabase
      .from("household_members")
      .select("role, households(id, name, timezone)")
      .eq("user_id", data.user.id)
      .order("created_at"),
  ]);

  const households = (memberships ?? []).flatMap((m) => {
    const h = m.households as unknown as HouseholdRow | null;
    return h ? [{ ...h, role: m.role as HouseholdRole }] : [];
  });
  const wanted = (await cookies()).get(HOUSEHOLD_COOKIE)?.value;
  const household = households.find((h) => h.id === wanted) ?? households[0] ?? null;

  return {
    mode: "cloud",
    user: { id: data.user.id, email: data.user.email ?? "", displayName: profile?.display_name || data.user.email || "" },
    households,
    household,
  };
});

/** Publieke (client-veilige) samenvatting van de sessie. */
export interface ClientSession {
  mode: "cloud" | "local";
  user: { id: string; email: string; displayName: string } | null;
  household: { id: string; name: string; role: HouseholdRole } | null;
  households: { id: string; name: string; role: HouseholdRole }[];
}

export function toClientSession(s: SessionInfo): ClientSession {
  const pick = (h: SessionInfo["households"][number]) => ({ id: h.id, name: h.name, role: h.role });
  return { mode: s.mode, user: s.user, household: s.household ? pick(s.household) : null, households: s.households.map(pick) };
}

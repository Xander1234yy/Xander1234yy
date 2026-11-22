"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DisplayNameSchema, HouseholdNameSchema, InviteSchema, RoleChangeSchema } from "@homeos/database";
import { connectorIdentity } from "@/lib/server/authz";
import { syncRoomsToConnector } from "@/lib/server/rooms-sync";
import { getSession } from "@/lib/session";
import { HOUSEHOLD_COOKIE } from "@/lib/supabase/config";
import { createSupabaseServer } from "@/lib/supabase/server";
import { fail, inHousehold, invalid, type ActionResult } from "./helpers";

const refresh = () => revalidatePath("/", "layout");

export async function renameHousehold(name: string): Promise<ActionResult> {
  const p = HouseholdNameSchema.safeParse(name);
  if (!p.success) return invalid(p.error.issues);
  return inHousehold("manage_household", async ({ supabase, householdId }) => {
    const { error } = await supabase.from("households").update({ name: p.data }).eq("id", householdId);
    if (error) return fail(error);
    refresh();
    return { ok: true };
  });
}

export async function updateDisplayName(name: string): Promise<ActionResult> {
  const p = DisplayNameSchema.safeParse(name);
  if (!p.success) return invalid(p.error.issues);
  const s = await getSession();
  if (s.mode !== "cloud" || !s.user) return { ok: false, error: "Niet ingelogd" };
  const supabase = await createSupabaseServer();
  const { error } = await supabase.from("profiles").update({ display_name: p.data }).eq("id", s.user.id);
  if (error) return fail(error);
  refresh();
  return { ok: true };
}

export async function updatePassword(password: string): Promise<ActionResult> {
  const p = z.string().min(10, "Wachtwoord moet minimaal 10 tekens hebben").max(128).safeParse(password);
  if (!p.success) return invalid(p.error.issues);
  const s = await getSession();
  if (s.mode !== "cloud" || !s.user) return { ok: false, error: "Niet ingelogd" };
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.updateUser({ password: p.data });
  if (error) return { ok: false, error: error.code === "same_password" ? "Kies een ander wachtwoord dan je huidige." : "Wachtwoord wijzigen is mislukt." };
  return { ok: true };
}

export async function addMember(input: unknown): Promise<ActionResult> {
  const p = InviteSchema.safeParse(input);
  if (!p.success) return invalid(p.error.issues);
  return inHousehold("manage_members", async ({ supabase, householdId }) => {
    const { error } = await supabase.rpc("add_household_member", { p_household: householdId, p_email: p.data.email, p_role: p.data.role });
    if (error) return fail(error);
    revalidatePath("/instellingen");
    return { ok: true };
  });
}

export async function changeMemberRole(input: unknown): Promise<ActionResult> {
  const p = RoleChangeSchema.safeParse(input);
  if (!p.success) return invalid(p.error.issues);
  return inHousehold("manage_members", async ({ supabase, householdId }) => {
    const { error } = await supabase.rpc("set_household_member_role", { p_household: householdId, p_user: p.data.userId, p_role: p.data.role });
    if (error) return fail(error);
    refresh();
    return { ok: true };
  });
}

export async function removeMember(userId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(userId).success) return { ok: false, error: "Ongeldig lid" };
  return inHousehold("manage_members", async ({ supabase, householdId }) => {
    const { error } = await supabase.rpc("remove_household_member", { p_household: householdId, p_user: userId });
    if (error) return fail(error);
    revalidatePath("/instellingen");
    return { ok: true };
  });
}

export async function leaveHousehold(): Promise<ActionResult> {
  const result = await inHousehold("view", async ({ supabase, householdId, userId }) => {
    const { error } = await supabase.rpc("remove_household_member", { p_household: householdId, p_user: userId });
    if (error) return fail(error);
    return { ok: true };
  });
  if (!result.ok) return result;
  (await cookies()).delete(HOUSEHOLD_COOKIE);
  redirect("/");
}

/** Koppelt de connector die nu bereikbaar is aan het actieve huishouden. */
export async function linkConnector(): Promise<ActionResult> {
  return inHousehold("manage_devices", async ({ supabase, householdId, userId }) => {
    let identity;
    try {
      identity = await connectorIdentity(true);
    } catch {
      return { ok: false, error: "De connector is niet bereikbaar. Start de HomeOS Device Connector op je laptop." };
    }
    const { error } = await supabase.from("connector_status").upsert(
      { household_id: householdId, connector_id: identity.connectorId, version: identity.version, online: true, last_seen_at: new Date().toISOString(), linked_by: userId, linked_at: new Date().toISOString() },
      { onConflict: "household_id" },
    );
    if (error) return error.code === "23505" ? { ok: false, error: "Deze connector is al gekoppeld aan een ander huishouden." } : fail(error);
    await syncRoomsToConnector(householdId);
    await supabase.from("audit_logs").insert({ household_id: householdId, action: "connector.link", target: identity.connectorId, ok: true });
    refresh();
    return { ok: true };
  });
}

export async function unlinkConnector(): Promise<ActionResult> {
  return inHousehold("manage_devices", async ({ supabase, householdId }) => {
    const { error } = await supabase.from("connector_status").delete().eq("household_id", householdId);
    if (error) return fail(error);
    await supabase.from("audit_logs").insert({ household_id: householdId, action: "connector.unlink", ok: true });
    refresh();
    return { ok: true };
  });
}

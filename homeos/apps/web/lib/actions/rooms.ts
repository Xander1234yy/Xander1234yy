"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RoomCreateSchema, RoomUpdateSchema } from "@homeos/database";
import { roomSlug } from "@homeos/shared";
import { syncRoomsToConnector } from "@/lib/server/rooms-sync";
import { fail, inHousehold, invalid, type ActionResult } from "./helpers";

export async function createRoom(input: unknown): Promise<ActionResult> {
  const p = RoomCreateSchema.safeParse(input);
  if (!p.success) return invalid(p.error.issues);
  return inHousehold("manage_rooms", async ({ supabase, householdId }) => {
    const { data: existing } = await supabase.from("rooms").select("slug, sort_order").eq("household_id", householdId);
    const slugs = new Set((existing ?? []).map((r) => r.slug as string));
    const base = roomSlug(p.data.name);
    let slug = base;
    for (let i = 2; slugs.has(slug); i++) slug = `${base}-${i}`;
    const order = Math.max(-1, ...(existing ?? []).map((r) => r.sort_order as number)) + 1;
    const { error } = await supabase.from("rooms").insert({ household_id: householdId, slug, name: p.data.name, icon: p.data.icon ?? "door-open", sort_order: order });
    if (error) return fail(error);
    await syncRoomsToConnector(householdId);
    revalidatePath("/kamers");
    return { ok: true };
  });
}

export async function renameRoom(input: unknown): Promise<ActionResult> {
  const p = RoomUpdateSchema.safeParse(input);
  if (!p.success) return invalid(p.error.issues);
  return inHousehold("manage_rooms", async ({ supabase, householdId }) => {
    const { error } = await supabase.from("rooms").update({ name: p.data.name }).eq("id", p.data.id).eq("household_id", householdId);
    if (error) return fail(error);
    await syncRoomsToConnector(householdId);
    revalidatePath("/kamers");
    return { ok: true };
  });
}

export async function deleteRoom(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Ongeldige kamer" };
  return inHousehold("manage_rooms", async ({ supabase, householdId }) => {
    const { error } = await supabase.from("rooms").delete().eq("id", id).eq("household_id", householdId);
    if (error) return fail(error);
    await syncRoomsToConnector(householdId);
    revalidatePath("/kamers");
    return { ok: true };
  });
}

/** Kamer-ID's (Supabase UUID) per slug, voor beheer vanuit de UI. */
export async function roomIdsBySlug(): Promise<ActionResult<Record<string, string>>> {
  return inHousehold<Record<string, string>>("view", async ({ supabase, householdId }) => {
    const { data, error } = await supabase.from("rooms").select("id, slug").eq("household_id", householdId);
    if (error) return fail(error);
    return { ok: true, value: Object.fromEntries((data ?? []).map((r) => [r.slug as string, r.id as string])) };
  });
}

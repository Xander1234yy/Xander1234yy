"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MaintenanceInputSchema } from "@homeos/database";
import { fail, inHousehold, invalid, type ActionResult } from "./helpers";

export async function saveMaintenance(id: string | null, input: unknown): Promise<ActionResult> {
  const p = MaintenanceInputSchema.safeParse(input);
  if (!p.success) return invalid(p.error.issues);
  if (id && !z.uuid().safeParse(id).success) return { ok: false, error: "Ongeldig item" };
  const row = {
    item_name: p.data.itemName,
    category: p.data.category,
    brand: p.data.brand,
    model: p.data.model,
    purchase_date: p.data.purchaseDate,
    warranty_until: p.data.warrantyUntil,
    last_service_at: p.data.lastServiceAt,
    next_service_at: p.data.nextServiceAt,
    notes: p.data.notes,
  };
  return inHousehold("family_write", async ({ supabase, householdId, userId }) => {
    const { error } = id
      ? await supabase.from("maintenance_records").update(row).eq("id", id).eq("household_id", householdId)
      : await supabase.from("maintenance_records").insert({ ...row, household_id: householdId, created_by: userId });
    if (error) return fail(error);
    revalidatePath("/onderhoud");
    return { ok: true };
  });
}

export async function deleteMaintenance(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Ongeldig item" };
  return inHousehold("family_write", async ({ supabase, householdId }) => {
    const { error } = await supabase.from("maintenance_records").delete().eq("id", id).eq("household_id", householdId);
    if (error) return fail(error);
    revalidatePath("/onderhoud");
    return { ok: true };
  });
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { EventInputSchema, NoteInputSchema, ShoppingInputSchema, TaskInputSchema } from "@homeos/database";
import { fail, inHousehold, invalid, type ActionResult } from "./helpers";

const Id = z.uuid();
const done = () => {
  revalidatePath("/familie");
  revalidatePath("/");
};

// ───── taken ─────
export async function addTask(input: unknown): Promise<ActionResult> {
  const p = TaskInputSchema.safeParse(input);
  if (!p.success) return invalid(p.error.issues);
  return inHousehold("family_write", async ({ supabase, householdId, userId }) => {
    const { error } = await supabase.from("family_tasks").insert({
      household_id: householdId,
      title: p.data.title,
      notes: p.data.notes,
      assigned_to: p.data.assignedTo,
      due_date: p.data.dueDate,
      created_by: userId,
    });
    if (error) return fail(error);
    done();
    return { ok: true };
  });
}

export async function setTaskDone(id: string, completed: boolean): Promise<ActionResult> {
  if (!Id.safeParse(id).success) return { ok: false, error: "Ongeldige taak" };
  return inHousehold("family_write", async ({ supabase, householdId }) => {
    const { error } = await supabase.from("family_tasks").update({ completed_at: completed ? new Date().toISOString() : null }).eq("id", id).eq("household_id", householdId);
    if (error) return fail(error);
    done();
    return { ok: true };
  });
}

// ───── boodschappen ─────
export async function addShoppingItem(input: unknown): Promise<ActionResult> {
  const p = ShoppingInputSchema.safeParse(input);
  if (!p.success) return invalid(p.error.issues);
  return inHousehold("family_write", async ({ supabase, householdId, userId }) => {
    const { error } = await supabase.from("shopping_items").insert({ household_id: householdId, name: p.data.name, quantity: p.data.quantity, created_by: userId });
    if (error) return fail(error);
    done();
    return { ok: true };
  });
}

export async function setShoppingChecked(id: string, checked: boolean): Promise<ActionResult> {
  if (!Id.safeParse(id).success) return { ok: false, error: "Ongeldig item" };
  return inHousehold("family_write", async ({ supabase, householdId }) => {
    const { error } = await supabase.from("shopping_items").update({ checked }).eq("id", id).eq("household_id", householdId);
    if (error) return fail(error);
    done();
    return { ok: true };
  });
}

export async function clearCheckedShopping(): Promise<ActionResult> {
  return inHousehold("family_write", async ({ supabase, householdId }) => {
    const { error } = await supabase.from("shopping_items").delete().eq("household_id", householdId).eq("checked", true);
    if (error) return fail(error);
    done();
    return { ok: true };
  });
}

// ───── agenda ─────
export async function addEvent(input: unknown): Promise<ActionResult> {
  const p = EventInputSchema.safeParse(input);
  if (!p.success) return invalid(p.error.issues);
  return inHousehold("family_write", async ({ supabase, householdId, userId }) => {
    const { error } = await supabase.from("calendar_events").insert({
      household_id: householdId,
      title: p.data.title,
      description: p.data.description,
      location: p.data.location,
      starts_at: p.data.startsAt,
      ends_at: p.data.endsAt,
      all_day: p.data.allDay,
      created_by: userId,
    });
    if (error) return fail(error);
    done();
    return { ok: true };
  });
}

// ───── notities ─────
export async function saveNote(id: string | null, input: unknown): Promise<ActionResult> {
  const p = NoteInputSchema.safeParse(input);
  if (!p.success) return invalid(p.error.issues);
  if (id && !Id.safeParse(id).success) return { ok: false, error: "Ongeldige notitie" };
  if (!p.data.title.trim() && !p.data.body.trim()) return { ok: false, error: "Notitie is leeg" };
  return inHousehold("family_write", async ({ supabase, householdId, userId }) => {
    const { error } = id
      ? await supabase.from("household_notes").update(p.data).eq("id", id).eq("household_id", householdId)
      : await supabase.from("household_notes").insert({ ...p.data, household_id: householdId, created_by: userId });
    if (error) return fail(error);
    done();
    return { ok: true };
  });
}

// ───── verwijderen (generiek, alleen toegestane tabellen) ─────
const DELETABLE = { task: "family_tasks", shopping: "shopping_items", event: "calendar_events", note: "household_notes" } as const;

export async function deleteFamilyItem(kind: keyof typeof DELETABLE, id: string): Promise<ActionResult> {
  if (!Object.hasOwn(DELETABLE, kind) || !Id.safeParse(id).success) return { ok: false, error: "Ongeldig item" };
  const table = DELETABLE[kind];
  return inHousehold("family_write", async ({ supabase, householdId }) => {
    const { error } = await supabase.from(table).delete().eq("id", id).eq("household_id", householdId);
    if (error) return fail(error);
    done();
    return { ok: true };
  });
}

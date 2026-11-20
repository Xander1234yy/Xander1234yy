"use server";

import type { CalendarEventRow } from "@homeos/database";
import { inHousehold, fail, type ActionResult } from "./helpers";

export interface FamilySummary {
  upcoming: Pick<CalendarEventRow, "id" | "title" | "starts_at" | "all_day" | "location">[];
  openTasks: number;
  shopping: { name: string; quantity: string }[];
  maintenanceDue: number;
}

/** Compacte samenvatting voor dashboard en Jarvis. */
export async function getFamilySummary(): Promise<ActionResult<FamilySummary>> {
  return inHousehold<FamilySummary>("view", async ({ supabase, householdId }) => {
    const now = new Date();
    const inWeek = new Date(now.getTime() + 7 * 86_400_000);
    const soon = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
    const [events, tasks, shopping, maintenance] = await Promise.all([
      supabase
        .from("calendar_events")
        .select("id, title, starts_at, all_day, location")
        .eq("household_id", householdId)
        .gte("starts_at", new Date(now.getTime() - 12 * 3600_000).toISOString())
        .lte("starts_at", inWeek.toISOString())
        .order("starts_at")
        .limit(5),
      supabase.from("family_tasks").select("id", { count: "exact", head: true }).eq("household_id", householdId).is("completed_at", null),
      supabase.from("shopping_items").select("name, quantity").eq("household_id", householdId).eq("checked", false).order("created_at").limit(50),
      supabase.from("maintenance_records").select("id", { count: "exact", head: true }).eq("household_id", householdId).lte("next_service_at", soon),
    ]);
    const err = events.error ?? tasks.error ?? shopping.error ?? maintenance.error;
    if (err) return fail(err);
    return {
      ok: true,
      value: {
        upcoming: (events.data ?? []) as FamilySummary["upcoming"],
        openTasks: tasks.count ?? 0,
        shopping: (shopping.data ?? []) as FamilySummary["shopping"],
        maintenanceDue: maintenance.count ?? 0,
      },
    };
  });
}

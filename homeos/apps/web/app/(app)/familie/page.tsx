import type { Metadata } from "next";
import type { CalendarEventRow, FamilyTaskRow, MemberRow, NoteRow, ShoppingItemRow } from "@homeos/database";
import { FamilyBoard } from "@/components/family/family-board";
import { NeedsAccount } from "@/components/needs-account";
import { PageHeader } from "@/components/section";
import { getSession } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { connectorFetch } from "@/lib/server/connector-client";
import type { AppleCalendar } from "@/components/family/family-board";

/** Apple-agenda (alleen-lezen) via de connector; ontbreekt die, dan gewoon zonder. */
async function appleCalendar(): Promise<AppleCalendar | null> {
  try {
    const res = await connectorFetch("/v1/calendar/events", { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) return null;
    const r = (await res.json()) as AppleCalendar & { connected: boolean };
    return r.connected ? r : null;
  } catch {
    return null;
  }
}

export const metadata: Metadata = { title: "Familie" };
export const dynamic = "force-dynamic";

export default async function FamilyPage() {
  const s = await getSession();
  if (s.mode === "local" || !s.household) return <NeedsAccount title="Familie" description="Agenda, taken, boodschappen en gedeelde notities." />;
  const supabase = await createSupabaseServer();
  const hid = s.household.id;
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [tasks, shopping, events, notes, members, apple] = await Promise.all([
    supabase.from("family_tasks").select("id, title, notes, assigned_to, due_date, completed_at, created_by, created_at").eq("household_id", hid).order("completed_at", { nullsFirst: true }).order("due_date", { nullsFirst: false }).limit(200),
    supabase.from("shopping_items").select("id, name, quantity, checked, created_at").eq("household_id", hid).order("checked").order("created_at").limit(300),
    supabase.from("calendar_events").select("id, title, description, location, starts_at, ends_at, all_day").eq("household_id", hid).gte("starts_at", since).order("starts_at").limit(200),
    supabase.from("household_notes").select("id, title, body, pinned, updated_at").eq("household_id", hid).order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(100),
    supabase.rpc("household_member_list", { p_household: hid }),
    appleCalendar(),
  ]);
  return (
    <div>
      <PageHeader title="Familie" description={`Gedeeld met iedereen in ${s.household.name}.`} />
      <FamilyBoard
        tasks={(tasks.data ?? []) as FamilyTaskRow[]}
        shopping={(shopping.data ?? []) as ShoppingItemRow[]}
        events={(events.data ?? []) as CalendarEventRow[]}
        notes={(notes.data ?? []) as NoteRow[]}
        members={(members.data ?? []) as MemberRow[]}
        apple={apple}
      />
    </div>
  );
}

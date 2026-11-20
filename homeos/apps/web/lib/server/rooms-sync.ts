import "server-only";
import type { RoomRow } from "@homeos/database";
import { createSupabaseServer } from "@/lib/supabase/server";
import { connectorFetch } from "./connector-client";

/** Zet de kamers uit Supabase (bron van waarheid) door naar de connector. Kamer-ID in de connector = slug. */
export async function syncRoomsToConnector(householdId: string): Promise<boolean> {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.from("rooms").select("slug, name, icon, sort_order").eq("household_id", householdId).order("sort_order");
  if (!data) return false;
  const rooms = (data as Pick<RoomRow, "slug" | "name" | "icon" | "sort_order">[]).map((r) => ({ id: r.slug, name: r.name, icon: r.icon, order: r.sort_order }));
  try {
    const res = await connectorFetch("/v1/rooms", { method: "PUT", body: JSON.stringify({ rooms }) });
    return res.ok;
  } catch {
    return false;
  }
}

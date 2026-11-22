import type { Metadata } from "next";
import type { MaintenanceRow } from "@homeos/database";
import { MaintenanceBoard } from "@/components/maintenance-board";
import { NeedsAccount } from "@/components/needs-account";
import { PageHeader } from "@/components/section";
import { getSession } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Onderhoud" };
export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const s = await getSession();
  if (s.mode === "local" || !s.household) return <NeedsAccount title="Onderhoud" description="Garanties, onderhoudsdata en herinneringen." />;
  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from("maintenance_records")
    .select("id, item_name, category, brand, model, purchase_date, warranty_until, last_service_at, next_service_at, notes")
    .eq("household_id", s.household.id)
    .order("next_service_at", { nullsFirst: false })
    .limit(300);
  return (
    <div>
      <PageHeader title="Onderhoud" description="Apparaten en installaties, garanties en onderhoudsmomenten." />
      <MaintenanceBoard records={(data ?? []) as MaintenanceRow[]} />
    </div>
  );
}

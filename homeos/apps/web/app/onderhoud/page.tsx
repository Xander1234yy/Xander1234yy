import type { Metadata } from "next";
import { Wrench } from "lucide-react";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Onderhoud" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Onderhoud"
      description="Garanties, onderhoudsdata en herinneringen."
      phase={2}
      icon={Wrench}
      requires="Onderhoudsrecords worden in Supabase opgeslagen (tabel maintenance_records); herinneringen lopen via de notificaties van fase 5."
      planned={["Apparaten en installaties registreren", "Garantiegegevens en aankoopdatum", "Onderhoudshistorie", "Herinneringen (bijv. cv-ketel, rookmelders)"]}
    />
  );
}

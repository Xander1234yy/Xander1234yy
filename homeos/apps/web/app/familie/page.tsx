import type { Metadata } from "next";
import { CalendarHeart } from "lucide-react";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Familie" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Familie"
      description="Agenda, taken, boodschappen en gedeelde notities."
      phase={2}
      icon={CalendarHeart}
      requires="Deze gegevens worden opgeslagen in Supabase, beveiligd met Row Level Security per huishouden."
      planned={["Gezamenlijke agenda", "Taken met toewijzing", "Boodschappenlijst (ook via Jarvis)", "Gedeelde notities", "Realtime synchronisatie tussen gezinsleden"]}
    />
  );
}

import type { Metadata } from "next";
import { Workflow } from "lucide-react";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Automatiseringen" };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Automatiseringen"
      description="Eigen rules engine: triggers, voorwaarden en acties."
      phase={5}
      icon={Workflow}
      requires="De motor draait lokaal in de connector, zodat automatiseringen ook zonder cloud werken. De noodstop is nu al actief en wordt door de motor gerespecteerd."
      planned={[
        "Triggers: tijdstip, dag, apparaatstatus, energie, handmatig",
        "Voorwaarden: tijd, dag, apparaat online, drempelwaarden",
        "Acties: Hue-scène, stekker, melding, Jarvis-rapport",
        "Schema's, herhalingen en wachttijden",
        "Bescherming tegen dubbele uitvoering en limieten",
        "Uitvoeringsgeschiedenis, pauzeknop en noodstop",
        "Nooit veiligheidskritische apparaten zelfstandig aansturen",
        "Voorbeelden: Avondmodus, Energiemelding, Apparaat offline",
      ]}
    />
  );
}

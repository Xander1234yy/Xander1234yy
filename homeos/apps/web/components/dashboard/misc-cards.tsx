"use client";

import { Bot, CalendarDays, Workflow } from "lucide-react";
import { Badge } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { JarvisChat } from "@/components/jarvis-chat";
import { useHome } from "@/lib/home-context";

export function JarvisCard() {
  return (
    <SectionCard title="Jarvis" description="Lokale assistent · zonder AI-provider" icon={Bot} href="/jarvis" testId="jarvis-card">
      <JarvisChat compact />
    </SectionCard>
  );
}

export function AutomationsCard() {
  const { snapshot } = useHome();
  const stop = snapshot?.connector.emergencyStop;
  return (
    <SectionCard title="Automatiseringen" icon={Workflow} href="/automatiseringen" action={<Badge tone="accent">Fase 5</Badge>} testId="automations-card">
      <p className="text-sm text-muted">De eigen automatiseringsmotor (triggers, voorwaarden, acties, schema's en uitvoeringsgeschiedenis) wordt in fase 5 gebouwd.</p>
      <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/[0.03] px-3 py-2.5 text-xs">
        <span className="text-muted">Noodstop</span>
        <span className={stop ? "font-medium text-warning" : "text-success"}>{stop ? "Actief — alles gepauzeerd" : "Niet actief"}</span>
      </div>
    </SectionCard>
  );
}

export function AgendaCard() {
  return (
    <SectionCard title="Agenda" icon={CalendarDays} href="/familie" action={<Badge tone="accent">Fase 2</Badge>} testId="agenda-card">
      <p className="text-sm text-muted">Gezinsagenda, taken en boodschappenlijst worden opgeslagen in Supabase met beveiliging per huishouden. Dit wordt gekoppeld in fase 2.</p>
    </SectionCard>
  );
}

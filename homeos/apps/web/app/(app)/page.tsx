"use client";

import { WelcomeCard } from "@/components/dashboard/welcome";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { DevicesOverview } from "@/components/dashboard/devices-overview";
import { EnergyCard } from "@/components/dashboard/energy-card";
import { LightsCard } from "@/components/dashboard/lights-card";
import { MediaCard } from "@/components/dashboard/media-card";
import { DoorbellCard } from "@/components/dashboard/doorbell-card";
import { AutomationsCard, JarvisCard } from "@/components/dashboard/misc-cards";
import { AgendaCard } from "@/components/dashboard/agenda-card";
import { ClimateCard } from "@/components/dashboard/climate-card";
import { ShortcutsCard } from "@/components/dashboard/shortcuts-card";
import { useEnergySummary } from "@/lib/use-energy";

export default function DashboardPage() {
  const { data: energy, live } = useEnergySummary();
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
      <div className="md:col-span-2 lg:col-span-8">
        <WelcomeCard energy={energy} />
      </div>
      <div className="md:col-span-2 lg:col-span-4">
        <QuickActions />
      </div>
      <ShortcutsSlot />
      <div className="md:col-span-2 lg:col-span-8">
        <EnergyCard energy={energy} live={live} />
      </div>
      <div className="lg:col-span-4">
        <DevicesOverview />
      </div>
      <div className="md:col-span-2 lg:col-span-5 lg:row-span-2">
        <LightsCard />
      </div>
      <div className="md:col-span-2 lg:col-span-7">
        <JarvisCard />
      </div>
      <div className="lg:col-span-4">
        <MediaCard />
      </div>
      <div className="lg:col-span-3">
        <DoorbellCard />
      </div>
      <div className="lg:col-span-4">
        <ClimateCard />
      </div>
      <div className="lg:col-span-4">
        <AutomationsCard />
      </div>
      <div className="md:col-span-2 lg:col-span-4">
        <AgendaCard />
      </div>
    </div>
  );
}

/** Neemt alleen ruimte in als er knoppen zijn (de kaart geeft dan null terug en de lege div valt weg via :empty). */
function ShortcutsSlot() {
  return (
    <div className="empty:hidden md:col-span-2 lg:col-span-12">
      <ShortcutsCard />
    </div>
  );
}

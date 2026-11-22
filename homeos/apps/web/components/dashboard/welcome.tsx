"use client";

import { useEffect, useState } from "react";
import { Card } from "@homeos/ui";
import { useHome, useLive } from "@/lib/home-context";
import { formatW, greeting, longDate } from "@/lib/format";
import type { EnergySummary } from "@homeos/shared";

export function WelcomeCard({ energy }: { energy: EnergySummary | null }) {
  const { snapshot } = useHome();
  const live = useLive();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);
  const devices = snapshot?.devices ?? [];
  const lightsOn = devices.filter((d) => d.kind === "light" && d.state.on && d.status === "ONLINE").length;
  const problems = devices.filter((d) => d.status !== "ONLINE").length;

  const parts: string[] = [];
  if (!live) parts.push("De connector is niet verbonden; hieronder zie je de laatst bekende gegevens.");
  else {
    parts.push(lightsOn ? `${lightsOn} ${lightsOn === 1 ? "lamp staat" : "lampen staan"} aan` : "Alle lampen zijn uit");
    if (energy?.currentProductionW != null) parts.push(`de zonnepanelen leveren ${formatW(energy.currentProductionW)}`);
    parts.push(problems ? `${problems} ${problems === 1 ? "apparaat vraagt" : "apparaten vragen"} aandacht` : "alle apparaten zijn online");
  }

  return (
    <Card className="flex h-full animate-fade-up flex-col justify-center overflow-hidden p-6 sm:p-8" data-testid="welcome-card">
      <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-accent/20 blur-3xl" />
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent-soft" suppressHydrationWarning>
        {now ? longDate(now) : " "}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl" suppressHydrationWarning>
        {now ? greeting(now) : "Welkom"}
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
        {parts.length > 1 ? `${parts[0]}, ${parts.slice(1, -1).join(", ")}${parts.length > 2 ? " en " : ""}${parts.at(-1)}.` : parts[0]}
      </p>
    </Card>
  );
}

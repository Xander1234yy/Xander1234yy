"use client";

import { LightbulbOff, OctagonPause, Play, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { useHome, useLive } from "@/lib/home-context";

export function QuickActions() {
  const { snapshot, sendCommand, activateScene, syncAll, setEmergencyStop, pending } = useHome();
  const live = useLive();
  const lightsOn = (snapshot?.devices ?? []).filter((d) => d.kind === "light" && d.state.on && d.status === "ONLINE");
  const stop = snapshot?.connector.emergencyStop ?? false;

  return (
    <SectionCard title="Snelle acties" icon={Sparkles} testId="quick-actions">
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          className="h-auto flex-col items-start gap-1 py-3 text-left"
          disabled={!live || lightsOn.length === 0}
          onClick={() => lightsOn.forEach((d) => void sendCommand(d, { type: "set_power", on: false }))}
        >
          <LightbulbOff className="text-accent" />
          <span>Alle lampen uit</span>
          <span className="text-[11px] font-normal text-muted">{lightsOn.length} aan</span>
        </Button>
        <Button variant="secondary" className="h-auto flex-col items-start gap-1 py-3 text-left" disabled={!live || pending.has("sync")} onClick={() => void syncAll()}>
          <RefreshCw className={pending.has("sync") ? "animate-spin text-accent" : "text-accent"} />
          <span>Synchroniseren</span>
          <span className="text-[11px] font-normal text-muted">Alle apparaten</span>
        </Button>
        {(snapshot?.scenes ?? []).slice(0, 2).map((s) => (
          <Button key={s.id} variant="secondary" className="h-auto flex-col items-start gap-1 py-3 text-left" disabled={!live || pending.has(s.id)} onClick={() => void activateScene(s.id)}>
            <Play className="text-accent" />
            <span>{s.name}</span>
            <span className="text-[11px] font-normal text-muted">Scène{s.demo ? " · demo" : ""}</span>
          </Button>
        ))}
      </div>
      <Button variant={stop ? "secondary" : "danger"} className="mt-2 w-full" disabled={!live} onClick={() => void setEmergencyStop(!stop)} data-testid="emergency-stop">
        <OctagonPause /> {stop ? "Noodstop opheffen" : "Noodstop: automatiseringen pauzeren"}
      </Button>
    </SectionCard>
  );
}

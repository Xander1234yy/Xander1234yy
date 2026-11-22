"use client";

import { useState } from "react";
import { LightbulbOff, OctagonPause, Play, Power, RefreshCw, Sparkles } from "lucide-react";
import { allOffCommands } from "@homeos/shared";
import { Button } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { useHome, useLive as useConnectorLive } from "@/lib/home-context";
import { useCan } from "@/components/session-context";
import { useToast } from "@/components/toast";

export function QuickActions() {
  const { snapshot, sendCommand, activateScene, syncAll, setEmergencyStop, pending } = useHome();
  const mayControl = useCan("control");
  const live = useConnectorLive() && mayControl;
  const lightsOn = (snapshot?.devices ?? []).filter((d) => d.kind === "light" && d.state.on && d.status === "ONLINE");
  const stop = snapshot?.connector.emergencyStop ?? false;
  const toast = useToast();
  const [allOffBusy, setAllOffBusy] = useState(false);
  const allOff = allOffCommands(snapshot?.devices ?? []);

  const runAllOff = async () => {
    const devices = new Map((snapshot?.devices ?? []).map((d) => [d.id, d]));
    const names = allOff.map((t) => devices.get(t.deviceId)?.name ?? t.deviceId);
    if (!confirm(`Alles uitzetten? Dit zet ${allOff.length} apparaat/apparaten uit:\n\n${names.join(", ")}\n\nLet op stekkers met bijvoorbeeld een koelkast of vriezer.`)) return;
    setAllOffBusy(true);
    try {
      const results = await Promise.all(allOff.map((t) => sendCommand(devices.get(t.deviceId)!, t.command)));
      const failed = results.filter((ok) => !ok).length;
      toast.push(
        failed
          ? { title: `${results.length - failed} uitgezet, ${failed} mislukt`, tone: "danger" }
          : { title: `${results.length} apparaat/apparaten uitgezet`, description: "Apparaten via Google Home: opdracht verstuurd, status niet bevestigd.", tone: "success" },
      );
    } finally {
      setAllOffBusy(false);
    }
  };

  return (
    <SectionCard title="Snelle acties" icon={Sparkles} testId="quick-actions">
      <Button variant="secondary" className="mb-2 w-full" disabled={!live || allOffBusy || allOff.length === 0} onClick={() => void runAllOff()} data-testid="all-off">
        <Power className="text-accent" /> {allOffBusy ? "Bezig met uitzetten…" : `Alles uit${allOff.length ? ` (${allOff.length})` : ""}`}
      </Button>
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

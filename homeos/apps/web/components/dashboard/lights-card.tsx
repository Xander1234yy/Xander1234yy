"use client";

import { Lightbulb } from "lucide-react";
import { cn } from "@homeos/ui";
import { SectionCard, EmptyState } from "@/components/section";
import { BrightnessSlider, PowerSwitch } from "@/components/devices/controls";
import { StatusBadge, DemoBadge } from "@/components/devices/status-badge";
import { useHome, useLive } from "@/lib/home-context";

export function LightsCard() {
  const { snapshot, activateScene, pending } = useHome();
  const live = useLive();
  const lights = (snapshot?.devices ?? []).filter((d) => d.kind === "light");
  const on = lights.filter((d) => d.state.on && d.status === "ONLINE").length;
  const room = (id: string | null) => snapshot?.rooms.find((r) => r.id === id)?.name ?? "Geen kamer";

  return (
    <SectionCard title="Verlichting" description={`${on} van ${lights.length} aan`} icon={Lightbulb} href="/kamers" testId="lights-card">
      {lights.length === 0 ? (
        <EmptyState icon={Lightbulb} title="Nog geen lampen">
          Lampen verschijnen hier zodra een verlichtingsintegratie (zoals Philips Hue, fase 3) gekoppeld is.
        </EmptyState>
      ) : (
        <>
          {(snapshot?.scenes.length ?? 0) > 0 && (
            <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
              {snapshot!.scenes.map((s) => (
                <button
                  key={s.id}
                  disabled={!live || pending.has(s.id)}
                  onClick={() => void activateScene(s.id)}
                  className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-muted transition hover:border-accent/50 hover:text-fg disabled:opacity-40"
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <ul className="space-y-1">
            {lights.slice(0, 6).map((d) => {
              const isOn = d.state.on && d.status === "ONLINE" && live;
              return (
                <li key={d.id} className="rounded-2xl px-2 py-2.5 transition hover:bg-white/[0.02]">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn("size-2.5 shrink-0 rounded-full", isOn ? "" : "bg-white/15")}
                      style={isOn ? { backgroundColor: d.state.colorHex ?? "#ffd8a8", boxShadow: `0 0 10px ${d.state.colorHex ?? "#ffd8a8"}` } : undefined}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm">
                        {d.name} <DemoBadge show={d.demo} />
                      </p>
                      <p className="text-[11px] text-muted">{room(d.roomId)}</p>
                    </div>
                    {d.status !== "ONLINE" && <StatusBadge device={d} />}
                    <PowerSwitch device={d} />
                  </div>
                  {isOn && d.capabilities.includes("brightness") && (
                    <div className="mt-2 pl-5">
                      <BrightnessSlider device={d} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

"use client";

import { Tv } from "lucide-react";
import { SectionCard, EmptyState } from "@/components/section";
import { MediaControls, TvControls } from "@/components/devices/controls";
import { DemoBadge, StatusBadge } from "@/components/devices/status-badge";
import { FreshnessNote } from "@/components/devices/freshness";
import { useHome } from "@/lib/home-context";

const PLAYBACK: Record<string, string> = { playing: "Speelt af", paused: "Gepauzeerd", idle: "Niets actief", unknown: "Onbekend" };

export function MediaCard() {
  const { snapshot } = useHome();
  const tv = snapshot?.devices.find((d) => d.kind === "media");
  return (
    <SectionCard title="Apple TV" icon={Tv} href="/entertainment" testId="media-card">
      {!tv ? (
        <EmptyState icon={Tv} title="Geen mediaspeler">
          Apple TV-ondersteuning wordt in fase 4 onderzocht en alleen gebouwd via een bewezen lokale verbinding.
        </EmptyState>
      ) : (
        <div>
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{tv.name}</p>
            <DemoBadge show={tv.demo} />
            <span className="ml-auto">
              <StatusBadge device={tv} />
            </span>
          </div>
          <div className="mt-4 rounded-2xl border border-white/[0.06] bg-gradient-to-br from-navy-700/60 to-navy-900 p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted">{tv.state.media?.power === "standby" ? "Stand-by" : PLAYBACK[tv.state.media?.playback ?? "unknown"]}</p>
            <p className="mt-1 truncate text-base font-semibold">{tv.state.media?.title ?? "—"}</p>
            <p className="truncate text-xs text-muted">{[tv.state.media?.artist, tv.state.media?.app].filter(Boolean).join(" · ") || " "}</p>
          </div>
          <div className="mt-3 flex justify-center">
            <MediaControls device={tv} />
          </div>
          <div className="mt-3">
            <TvControls device={tv} />
          </div>
          <FreshnessNote device={tv} />
        </div>
      )}
    </SectionCard>
  );
}

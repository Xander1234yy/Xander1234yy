"use client";

import { Tv } from "lucide-react";
import { Card } from "@homeos/ui";
import { PageHeader, EmptyState } from "@/components/section";
import { MediaControls, TvControls } from "@/components/devices/controls";
import { DemoBadge, StatusBadge } from "@/components/devices/status-badge";
import { FreshnessNote } from "@/components/devices/freshness";
import { useHome } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

export default function EntertainmentPage() {
  const { snapshot } = useHome();
  const media = (snapshot?.devices ?? []).filter((d) => d.kind === "media");
  return (
    <div>
      <PageHeader title="Entertainment" description="Mediaspelers, verbindingsstatus en beschikbare bediening." />
      {media.length === 0 ? (
        <EmptyState icon={Tv} title="Geen mediaspelers">
          Koppel een LG-tv (webOS) bij Instellingen → LG-tv. Apple TV wordt niet ondersteund: er is geen officiële koppeling.
        </EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {media.map((tv) => (
            <Card key={tv.id} className="p-6">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">{tv.name}</h2>
                <DemoBadge show={tv.demo} />
                <span className="ml-auto">
                  <StatusBadge device={tv} />
                </span>
              </div>
              <p className="text-xs text-muted">
                {tv.brand} {tv.model} · gezien {formatDateTime(tv.lastSeen)}
              </p>
              <div className="mt-6 flex aspect-video flex-col justify-end rounded-3xl border border-white/[0.06] bg-[radial-gradient(circle_at_30%_20%,rgba(79,140,255,0.35),transparent_60%),linear-gradient(180deg,#111b33,#060a14)] p-6">
                <p className="text-xs uppercase tracking-widest text-accent-soft">{tv.state.media?.app ?? (tv.state.media?.power === "standby" ? "Stand-by" : "—")}</p>
                <p className="mt-1 text-2xl font-semibold">{tv.state.media?.title ?? "Niets aan het afspelen"}</p>
                {tv.state.media?.artist && <p className="text-sm text-muted">{tv.state.media.artist}</p>}
              </div>
              <div className="mt-5 flex justify-center">
                <MediaControls device={tv} size="lg" />
              </div>
              <div className="mx-auto mt-4 max-w-md">
                <TvControls device={tv} />
              </div>
              {tv.status === "OFFLINE" && tv.capabilities.includes("wake_on_lan") && (
                <p className="mt-4 text-center text-xs text-muted">De tv staat uit. Met de aan/uit-knop zet HomeOS hem aan via het netwerk.</p>
              )}
              <FreshnessNote device={tv} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

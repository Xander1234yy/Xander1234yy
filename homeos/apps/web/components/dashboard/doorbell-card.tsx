"use client";

import { BatteryMedium, BellRing, Footprints } from "lucide-react";
import { SectionCard, EmptyState } from "@/components/section";
import { DemoBadge, StatusBadge } from "@/components/devices/status-badge";
import { useHome } from "@/lib/home-context";
import { formatDateTime, relativeTime } from "@/lib/format";

export function DoorbellCard() {
  const { snapshot, events } = useHome();
  const bell = snapshot?.devices.find((d) => d.kind === "doorbell");
  const recent = events.filter((e) => e.deviceId === bell?.id && (e.type === "doorbell_ring" || e.type === "motion")).slice(0, 4);
  return (
    <SectionCard title="Deurbel" icon={BellRing} href="/beveiliging" testId="doorbell-card">
      {!bell ? (
        <EmptyState icon={BellRing} title="Geen deurbel gekoppeld">
          Deurbelintegraties volgen in fase 4, alleen via officiële koppelingen.
        </EmptyState>
      ) : (
        <div>
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{bell.name}</p>
            <DemoBadge show={bell.demo} />
            <span className="ml-auto">
              <StatusBadge device={bell} />
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl bg-white/[0.03] p-3">
              <BellRing className="mx-auto size-4 text-accent" />
              <p className="mt-1.5 text-xs font-medium">{relativeTime(bell.state.lastRingAt)}</p>
              <p className="text-[10px] text-muted">Aangebeld</p>
            </div>
            <div className="rounded-2xl bg-white/[0.03] p-3">
              <Footprints className="mx-auto size-4 text-accent" />
              <p className="mt-1.5 text-xs font-medium">{relativeTime(bell.state.lastMotionAt)}</p>
              <p className="text-[10px] text-muted">Beweging</p>
            </div>
            <div className="rounded-2xl bg-white/[0.03] p-3">
              <BatteryMedium className="mx-auto size-4 text-accent" />
              <p className="mt-1.5 text-xs font-medium">{bell.state.batteryPct ?? "—"}%</p>
              <p className="text-[10px] text-muted">Batterij</p>
            </div>
          </div>
          {recent.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {recent.map((e) => (
                <li key={e.id} className="flex justify-between gap-2 text-xs">
                  <span className="truncate text-muted">{e.message}</span>
                  <span className="shrink-0 tabular text-muted/70">{formatDateTime(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SectionCard>
  );
}

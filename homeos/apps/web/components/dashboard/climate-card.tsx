"use client";

import { AirVent } from "lucide-react";
import { EmptyState, SectionCard } from "@/components/section";
import { ClimateControl, PowerSwitch, hvacModeLabel } from "@/components/devices/controls";
import { FreshnessNote } from "@/components/devices/freshness";
import { StatusBadge } from "@/components/devices/status-badge";
import { useHome } from "@/lib/home-context";

export function ClimateCard() {
  const { snapshot } = useHome();
  const units = (snapshot?.devices ?? []).filter((d) => d.kind === "climate");
  return (
    <SectionCard title="Klimaat" description={units.length ? `${units.length} airco${units.length === 1 ? "" : "'s"}` : undefined} icon={AirVent} href="/apparaten" testId="climate-card">
      {units.length === 0 ? (
        <EmptyState icon={AirVent} title="Geen airco gekoppeld">
          Koppel Daikin Onecta via Instellingen.
        </EmptyState>
      ) : (
        <ul className="space-y-5">
          {units.map((d) => (
            <li key={d.id}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="text-[11px] text-muted">
                    Binnen {d.state.climate?.roomTempC != null ? `${d.state.climate.roomTempC.toLocaleString("nl-NL")} °C` : "—"} ·{" "}
                    {d.state.on === false ? "uit" : hvacModeLabel(d.state.climate?.mode)}
                  </p>
                </div>
                {d.status !== "ONLINE" && <StatusBadge device={d} />}
                <PowerSwitch device={d} />
              </div>
              <div className="mt-3">
                <ClimateControl device={d} />
              </div>
              <FreshnessNote device={d} />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

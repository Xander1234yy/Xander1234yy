"use client";

import { BellRing, EyeOff, ShieldCheck } from "lucide-react";
import { Card } from "@homeos/ui";
import { PageHeader, SectionCard, EmptyState } from "@/components/section";
import { DeviceReadings } from "@/components/devices/device-card";
import { DemoBadge, StatusBadge } from "@/components/devices/status-badge";
import { FreshnessNote } from "@/components/devices/freshness";
import { useHome } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

export default function SecurityPage() {
  const { snapshot, events } = useHome();
  const bells = (snapshot?.devices ?? []).filter((d) => d.kind === "doorbell");
  const ids = new Set(bells.map((b) => b.id));
  const securityEvents = events.filter((e) => ids.has(e.deviceId) || e.type === "status_change");
  return (
    <div>
      <PageHeader title="Beveiliging" description="Deurbel, meldingen en privacy." />
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-5">
          {bells.length === 0 && (
            <EmptyState icon={BellRing} title="Geen deurbel gekoppeld">
              Deurbelintegraties volgen in fase 4 via officiële koppelingen.
            </EmptyState>
          )}
          {bells.map((b) => (
            <Card key={b.id} className="p-5">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">{b.name}</h2>
                <DemoBadge show={b.demo} />
                <span className="ml-auto">
                  <StatusBadge device={b} />
                </span>
              </div>
              <p className="mb-4 text-xs text-muted">
                {b.brand} {b.model}
              </p>
              <DeviceReadings device={b} />
              <FreshnessNote device={b} />
            </Card>
          ))}
          <SectionCard title="Privacy" icon={EyeOff}>
            <ul className="space-y-2 text-sm text-muted">
              <li>• Camerabeelden worden nooit openbaar toegankelijk gemaakt.</li>
              <li>• Momenteel worden geen snapshots of video opgeslagen.</li>
              <li>• Gebeurtenissen staan alleen lokaal in het connectorlogboek op je laptop.</li>
              <li>• Instelbare bewaartermijnen en snapshots (indien de integratie dat officieel ondersteunt) volgen in fase 4.</li>
            </ul>
          </SectionCard>
        </div>
        <SectionCard title="Meldingen" description="Deurbel en verbindingswijzigingen" icon={ShieldCheck} className="lg:col-span-7">
          {securityEvents.length === 0 ? (
            <p className="text-sm text-muted">Nog geen meldingen.</p>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {securityEvents.slice(0, 40).map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm">
                      {e.message} {e.demo && <span className="text-[10px] font-semibold text-demo">DEMO</span>}
                    </p>
                    <p className="text-[11px] text-muted">{e.type.replace("_", " ")}</p>
                  </div>
                  <span className="shrink-0 text-xs tabular text-muted">{formatDateTime(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

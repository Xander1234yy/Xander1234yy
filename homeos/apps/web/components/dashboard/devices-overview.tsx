"use client";

import { Cpu } from "lucide-react";
import { effectiveStatus } from "@homeos/shared";
import { SectionCard } from "@/components/section";
import { DeviceIcon } from "@/components/devices/device-icon";
import { useHome, useLive } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

export function DevicesOverview() {
  const { snapshot } = useHome();
  const live = useLive();
  const devices = snapshot?.devices ?? [];
  const count = (s: string) => devices.filter((d) => effectiveStatus(d, live) === s).length;
  const problems = live ? devices.filter((d) => d.status !== "ONLINE") : [];
  const tiles = [
    { label: "Online", value: count("ONLINE"), cls: "text-success" },
    { label: "Offline", value: count("OFFLINE"), cls: "text-danger" },
    { label: "Fout", value: count("ERROR"), cls: "text-danger" },
    { label: "Onbekend", value: count("UNKNOWN") + count("CONNECTING"), cls: "text-muted" },
  ];
  return (
    <SectionCard title="Apparaten" description={`${devices.length} apparaten geregistreerd`} icon={Cpu} href="/apparaten" testId="devices-overview">
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-white/[0.05] bg-white/[0.02] px-2 py-3 text-center">
            <p className={`text-xl font-semibold tabular ${t.cls}`}>{t.value}</p>
            <p className="text-[10px] text-muted">{t.label}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2">
        {!live && <p className="text-xs text-muted">Status onbekend zolang de connector offline is.</p>}
        {live && problems.length === 0 && <p className="text-xs text-muted">Alle apparaten werken naar behoren.</p>}
        {problems.slice(0, 4).map((d) => (
          <div key={d.id} className="flex items-center gap-3 rounded-xl bg-danger/[0.06] px-3 py-2">
            <DeviceIcon kind={d.kind} className="size-4 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{d.name}</p>
              <p className="truncate text-[11px] text-muted">
                {d.status.toLowerCase()} · laatst gezien {formatDateTime(d.lastSeen)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

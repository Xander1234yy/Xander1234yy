"use client";

import { Badge } from "@homeos/ui";
import { effectiveStatus, type Device } from "@homeos/shared";
import { useHome } from "@/lib/home-context";

const MAP: Record<Device["status"], { label: string; tone: "success" | "neutral" | "warning" | "danger" }> = {
  ONLINE: { label: "Online", tone: "success" },
  OFFLINE: { label: "Offline", tone: "danger" },
  CONNECTING: { label: "Verbinden", tone: "warning" },
  ERROR: { label: "Fout", tone: "danger" },
  UNKNOWN: { label: "Onbekend", tone: "neutral" },
};

export function StatusBadge({ device }: { device: Device }) {
  const { connector, fromCache } = useHome();
  const status = effectiveStatus(device, connector === "online" && !fromCache);
  const m = MAP[status];
  return (
    <Badge tone={m.tone} data-status={status}>
      {m.label}
    </Badge>
  );
}

export function DemoBadge({ show }: { show: boolean }) {
  return show ? <Badge tone="demo">Demo</Badge> : null;
}

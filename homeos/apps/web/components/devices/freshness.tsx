"use client";

import { Clock } from "lucide-react";
import { stateFreshness, type Device } from "@homeos/shared";
import { useHome } from "@/lib/home-context";
import { formatDateTime, relativeTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";

/** Laat zien hoe oud de getoonde status is. Nooit verouderde gegevens als live presenteren. */
export function FreshnessNote({ device }: { device: Device }) {
  const { connector, fromCache } = useHome();
  const now = useNow(15_000);
  const f = stateFreshness(device, { connectorOnline: connector === "online" && !fromCache, now });
  if (f === "live") return null;
  return (
    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-warning/90">
      <Clock className="size-3" />
      {f === "unknown" ? "Nog nooit uitgelezen" : `Laatst bekend ${relativeTime(device.stateUpdatedAt, now)} · gezien ${formatDateTime(device.lastSeen)}`}
    </p>
  );
}

"use client";

import { Cloud, CloudOff, Laptop } from "lucide-react";
import { cn } from "@homeos/ui";
import { useHome, type LinkState } from "@/lib/home-context";
import { relativeTime } from "@/lib/format";

function Dot({ state }: { state: LinkState }) {
  return (
    <span
      className={cn(
        "size-2 rounded-full",
        state === "online" && "bg-success shadow-[0_0_8px_rgba(52,211,153,0.8)]",
        state === "offline" && "bg-danger",
        state === "connecting" && "animate-pulse-soft bg-warning",
      )}
    />
  );
}

const label = (s: LinkState) => (s === "online" ? "online" : s === "offline" ? "offline" : "verbinden…");

/** Toont los van elkaar: cloud (webapp) en lokale connector. */
export function ConnectionPill({ compact = false }: { compact?: boolean }) {
  const { cloud, connector, lastSync } = useHome();
  const CloudIcon = cloud === "offline" ? CloudOff : Cloud;
  return (
    <div
      className="flex items-center gap-3 rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1.5 text-xs text-muted"
      title={`Cloud: ${label(cloud)} · Connector: ${label(connector)} · Laatste sync: ${relativeTime(lastSync)}`}
      data-testid="connection-pill"
    >
      <span className="flex items-center gap-1.5">
        <CloudIcon className="size-3.5" />
        {!compact && <span className="hidden sm:inline">Cloud</span>}
        <Dot state={cloud} />
      </span>
      <span className="h-3 w-px bg-white/10" />
      <span className="flex items-center gap-1.5">
        <Laptop className="size-3.5" />
        {!compact && <span className="hidden sm:inline">Connector</span>}
        <Dot state={connector} />
      </span>
    </div>
  );
}

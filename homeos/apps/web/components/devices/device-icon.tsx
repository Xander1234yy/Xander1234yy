import { BellRing, Cable, Gauge, Lightbulb, Plug, Router, Sun, Tv, type LucideIcon } from "lucide-react";
import type { Device } from "@homeos/shared";

const ICONS: Record<Device["kind"], LucideIcon> = {
  light: Lightbulb,
  plug: Plug,
  media: Tv,
  solar_inverter: Sun,
  energy_meter: Gauge,
  doorbell: BellRing,
  bridge: Router,
};

export function DeviceIcon({ kind, className }: { kind: Device["kind"]; className?: string }) {
  const Icon = ICONS[kind] ?? Cable;
  return <Icon className={className} />;
}

export const KIND_LABEL: Record<Device["kind"], string> = {
  light: "Lamp",
  plug: "Slimme stekker",
  media: "Mediaspeler",
  solar_inverter: "Zonnepanelen",
  energy_meter: "Energiemeter",
  doorbell: "Deurbel",
  bridge: "Bridge",
};

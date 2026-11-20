"use client";

import { useState } from "react";
import { ChevronDown, RefreshCw, Trash2 } from "lucide-react";
import { Button, Card, Input, cn } from "@homeos/ui";
import type { Device } from "@homeos/shared";
import { enc } from "@/lib/api";
import { useHome, useLive } from "@/lib/home-context";
import { formatDateTime, formatKwh, formatTime, formatW } from "@/lib/format";
import { BrightnessSlider, ColorControl, ColorTempControl, MediaControls, PowerSwitch } from "./controls";
import { DeviceIcon, KIND_LABEL } from "./device-icon";
import { FreshnessNote } from "./freshness";
import { DemoBadge, StatusBadge } from "./status-badge";

export function DeviceReadings({ device }: { device: Device }) {
  const s = device.state;
  const items: [string, string][] = [];
  if (device.capabilities.includes("power_metering")) {
    items.push(["Vermogen", formatW(s.powerW)], ["Vandaag", formatKwh(s.energyTodayKwh, 2)]);
  }
  if (device.capabilities.includes("energy_production")) items.push(["Opwek", formatW(s.productionW)], ["Vandaag", formatKwh(s.energyTodayKwh)]);
  if (device.capabilities.includes("energy_grid")) {
    items.push([s.powerW != null && s.powerW < 0 ? "Teruglevering" : "Afname", formatW(s.powerW != null ? Math.abs(s.powerW) : null)]);
  }
  if (device.capabilities.includes("battery")) items.push(["Batterij", s.batteryPct != null ? `${s.batteryPct}%` : "—"]);
  if (device.capabilities.includes("doorbell")) items.push(["Laatst gebeld", formatDateTime(s.lastRingAt)]);
  if (device.capabilities.includes("motion")) items.push(["Beweging", formatDateTime(s.lastMotionAt)]);
  if (device.state.media) items.push(["Speelt", s.media?.title ?? (s.media?.power === "standby" ? "Stand-by" : "Niets")]);
  if (!items.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
      {items.map(([k, v]) => (
        <div key={k + v}>
          <dt className="text-[11px] text-muted">{k}</dt>
          <dd className="text-sm tabular text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DeviceCard({ device }: { device: Device }) {
  const { snapshot, mutate, pending } = useHome();
  const live = useLive();
  const [manage, setManage] = useState(false);
  const [name, setName] = useState(device.name);
  const room = snapshot?.rooms.find((r) => r.id === device.roomId);
  const on = device.state.on && device.status === "ONLINE" && live;

  return (
    <Card className={cn("transition-colors", on && device.kind === "light" && "border-accent/20")} data-testid="device-card" data-device-id={device.id}>
      <div className="p-5">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.04] text-muted transition",
              on && "border-transparent text-ink",
            )}
            style={on ? { backgroundColor: device.state.colorHex ?? "#ffd8a8", boxShadow: `0 0 24px -4px ${device.state.colorHex ?? "#ffd8a8"}` } : undefined}
          >
            <DeviceIcon kind={device.kind} className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="truncate text-sm font-semibold">{device.name}</h3>
              <DemoBadge show={device.demo} />
            </div>
            <p className="truncate text-xs text-muted">
              {room?.name ?? "Geen kamer"} · {device.brand} {device.model}
            </p>
            <div className="mt-1.5">
              <StatusBadge device={device} />
            </div>
          </div>
          <PowerSwitch device={device} />
        </div>

        <div className="mt-4 space-y-3 empty:hidden">
          <BrightnessSlider device={device} />
          <ColorTempControl device={device} />
          <ColorControl device={device} />
          <MediaControls device={device} />
          <DeviceReadings device={device} />
        </div>

        {device.error && device.status !== "ONLINE" && <p className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">{device.error}</p>}
        <FreshnessNote device={device} />

        <button onClick={() => setManage((m) => !m)} className="mt-4 flex w-full items-center justify-between text-xs text-muted hover:text-fg" aria-expanded={manage}>
          <span>Beheer · {KIND_LABEL[device.kind]} · gezien {formatTime(device.lastSeen)}</span>
          <ChevronDown className={cn("size-4 transition", manage && "rotate-180")} />
        </button>

        {manage && (
          <div className="mt-3 space-y-3 border-t border-white/[0.06] pt-3">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && name !== device.name) void mutate(`v1/devices/${enc(device.id)}`, "PATCH", { name: name.trim() }, "Naam gewijzigd");
              }}
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Naam" disabled={!live} />
              <Button type="submit" size="md" disabled={!live || !name.trim() || name === device.name}>
                Opslaan
              </Button>
            </form>
            <select
              value={device.roomId ?? ""}
              disabled={!live}
              onChange={(e) => void mutate(`v1/devices/${enc(device.id)}`, "PATCH", { roomId: e.target.value || null }, "Apparaat verplaatst")}
              className="h-10 w-full rounded-xl border border-white/[0.08] bg-navy-850 px-3 text-sm text-fg"
              aria-label="Kamer"
            >
              <option value="">Geen kamer</option>
              {snapshot?.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <dl className="grid grid-cols-2 gap-2 text-[11px] text-muted">
              <dt>Integratie</dt>
              <dd className="text-fg">{device.integration}{device.demo ? " (demo)" : ""}</dd>
              <dt>Functies</dt>
              <dd className="text-fg">{device.capabilities.join(", ") || "—"}</dd>
              <dt>ID</dt>
              <dd className="truncate font-mono text-fg">{device.id}</dd>
            </dl>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={!live || pending.has(device.id)} onClick={() => void mutate(`v1/devices/${enc(device.id)}/sync`, "POST", undefined, "Gesynchroniseerd")}>
                <RefreshCw /> Synchroniseren
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={!live}
                onClick={() => {
                  if (confirm(`${device.name} verwijderen uit HomeOS? Je kunt het later opnieuw toevoegen.`)) void mutate(`v1/devices/${enc(device.id)}`, "DELETE", undefined, "Apparaat verwijderd");
                }}
              >
                <Trash2 /> Verwijderen
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

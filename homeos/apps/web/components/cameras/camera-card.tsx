"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, Eye, EyeOff, Lock, Radio, Square } from "lucide-react";
import type { Device } from "@homeos/shared";
import { Button, Card, cn } from "@homeos/ui";
import { StatusBadge } from "@/components/devices/status-badge";
import { useCan } from "@/components/session-context";
import { useHome, useLive } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

const LIVE_LIMIT_MS = 5 * 60_000;
const SNAPSHOT_MS = 15_000;

/**
 * Camera: momentopname (ververst elke 15 s zolang de pagina zichtbaar is), live beeld op verzoek (max. 5 min per keer),
 * draaien/kantelen voor wie mag bedienen. Beelden gaan alleen via de eigen webapp en worden niet opgeslagen.
 */
export function CameraCard({ device }: { device: Device }) {
  const canView = useCan("view_cameras");
  const canControl = useCan("control");
  const connectorLive = useLive();
  const { sendCommand, pending } = useHome();
  const [tick, setTick] = useState(() => Date.now());
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const online = device.status === "ONLINE" && connectorLive;
  // Camera's via de TP-Link-cloud (niet-officieel) hebben (nog) geen beeld: alleen meldingen, privacymodus en draaien.
  const hasStream = device.capabilities.includes("camera_stream");
  const privacyOn = device.state.on === false;
  const enc = encodeURIComponent(device.id);

  useEffect(() => {
    if (!canView || !online || live || !hasStream) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") setTick(Date.now());
    }, SNAPSHOT_MS);
    return () => clearInterval(t);
  }, [canView, online, live, hasStream]);

  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => setLive(false), LIVE_LIMIT_MS);
    return () => clearTimeout(t);
  }, [live]);

  const src = live ? `/api/cameras/${enc}/stream?s=${tick}` : `/api/cameras/${enc}/snapshot?t=${tick}`;
  const busy = pending.has(device.id);
  const move = (direction: "up" | "down" | "left" | "right") => void sendCommand(device, { type: "ptz_move", direction });

  return (
    <Card className="overflow-hidden p-0" data-testid="camera-card">
      <div className="relative aspect-video bg-black/60">
        {!canView ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted">
            <Lock className="size-5" /> Camerabeelden zijn alleen zichtbaar voor leden van het huishouden.
          </div>
        ) : !hasStream ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted">
            {privacyOn ? <EyeOff className="size-5" /> : <Camera className="size-5" />}
            {privacyOn ? "Privacymodus staat aan: de camera kijkt niet." : "Geen live beeld via de TP-Link-cloud. Meldingen, privacymodus en draaien werken wel."}
          </div>
        ) : !online ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted">
            <Camera className="size-5" /> {device.error ?? "Camera niet bereikbaar"}
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- MJPEG/JPEG van de eigen API, geen statische afbeelding
          <img
            key={src}
            src={src}
            alt={`${live ? "Live beeld" : "Momentopname"} van ${device.name}`}
            className="h-full w-full object-contain"
            onError={() => {
              setError(live ? "Live beeld gestopt of niet beschikbaar." : "Geen beeld van de camera. Is ffmpeg geïnstalleerd op de laptop?");
              setLive(false);
            }}
            onLoad={() => setError(null)}
          />
        )}
        {live && (
          <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-danger/80 px-2 py-0.5 text-[11px] font-semibold text-white">
            <Radio className="size-3" /> LIVE
          </span>
        )}
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">{device.name}</h2>
          <span className="ml-auto">
            <StatusBadge device={device} />
          </span>
        </div>
        <p className="text-xs text-muted">
          {device.brand} {device.model} · laatste beweging: {device.state.lastMotionAt ? formatDateTime(device.state.lastMotionAt) : "nog niet gezien"}
        </p>
        {error && <p className="text-xs text-danger">{error}</p>}
        {device.brand.includes("niet-officieel") && <p className="text-[11px] text-warning">Niet-officiële koppeling via de TP-Link-cloud: kan zonder aankondiging stoppen.</p>}
        {canView && online && (
          <div className="flex flex-wrap items-center gap-2">
            {device.capabilities.includes("onoff") && canControl && (
              <Button size="sm" variant={privacyOn ? "primary" : "secondary"} disabled={busy} onClick={() => void sendCommand(device, { type: "set_power", on: privacyOn })} aria-label={privacyOn ? `${device.name} aanzetten (privacymodus uit)` : `${device.name} uitzetten (privacymodus aan)`}>
                {privacyOn ? <Eye /> : <EyeOff />} {privacyOn ? "Camera aan" : "Privacymodus"}
              </Button>
            )}
            {hasStream && (
            <Button
              size="sm"
              variant={live ? "danger" : "primary"}
              onClick={() => {
                setTick(Date.now());
                setLive((l) => !l);
              }}
            >
              {live ? <Square /> : <Radio />} {live ? "Stop live" : "Live bekijken"}
            </Button>
            )}
            {device.capabilities.includes("ptz") && canControl && (
              <div className={cn("ml-auto grid grid-cols-3 gap-1", busy && "opacity-60")} role="group" aria-label="Camera draaien">
                <span />
                <Button size="icon-sm" variant="secondary" disabled={busy} onClick={() => move("up")} aria-label="Camera omhoog">
                  <ArrowUp />
                </Button>
                <span />
                <Button size="icon-sm" variant="secondary" disabled={busy} onClick={() => move("left")} aria-label="Camera naar links">
                  <ArrowLeft />
                </Button>
                <Button size="icon-sm" variant="secondary" disabled={busy} onClick={() => move("down")} aria-label="Camera omlaag">
                  <ArrowDown />
                </Button>
                <Button size="icon-sm" variant="secondary" disabled={busy} onClick={() => move("right")} aria-label="Camera naar rechts">
                  <ArrowRight />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Power, SkipBack, SkipForward } from "lucide-react";
import { Button, Slider, Switch, cn } from "@homeos/ui";
import { supportsCommand, type Device } from "@homeos/shared";
import { useHome, useLive } from "@/lib/home-context";
import { useCan } from "@/components/session-context";

const SWATCHES = ["#fff4e5", "#ffd8a8", "#ffb36b", "#ff8a3d", "#ff5d73", "#c084fc", "#3a5bff", "#38bdf8", "#34d399"];

function useControl(device: Device) {
  const { sendCommand, pending } = useHome();
  const live = useLive();
  const allowed = useCan("control");
  const usable = live && allowed && device.status === "ONLINE";
  return { sendCommand, busy: pending.has(device.id), usable };
}

export function PowerSwitch({ device }: { device: Device }) {
  const { sendCommand, busy, usable } = useControl(device);
  if (!supportsCommand(device, "set_power")) return null;
  return (
    <Switch
      checked={!!device.state.on}
      disabled={!usable || busy}
      onCheckedChange={(on) => void sendCommand(device, { type: "set_power", on })}
      aria-label={`${device.name} ${device.state.on ? "uitzetten" : "aanzetten"}`}
    />
  );
}

export function BrightnessSlider({ device }: { device: Device }) {
  const { sendCommand, busy, usable } = useControl(device);
  const [value, setValue] = useState(device.state.brightness ?? 100);
  useEffect(() => {
    setValue(device.state.brightness ?? 100);
  }, [device.state.brightness]);
  if (!supportsCommand(device, "set_brightness")) return null;
  return (
    <div className="flex items-center gap-3">
      <Slider
        value={[value]}
        min={1}
        max={100}
        step={1}
        disabled={!usable || busy}
        onValueChange={([v]) => setValue(v ?? value)}
        onValueCommit={([v]) => v && void sendCommand(device, { type: "set_brightness", brightness: v })}
        aria-label={`Helderheid ${device.name}`}
      />
      <span className="w-10 text-right text-xs tabular text-muted">{value}%</span>
    </div>
  );
}

export function ColorControl({ device }: { device: Device }) {
  const { sendCommand, busy, usable } = useControl(device);
  if (!supportsCommand(device, "set_color")) return null;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={`Kleur ${device.name}`}>
      {SWATCHES.map((c) => (
        <button
          key={c}
          disabled={!usable || busy}
          onClick={() => void sendCommand(device, { type: "set_color", colorHex: c })}
          className={cn(
            "size-7 rounded-full border-2 transition hover:scale-110 disabled:opacity-40",
            device.state.colorHex?.toLowerCase() === c ? "border-white" : "border-transparent",
          )}
          style={{ backgroundColor: c }}
          aria-label={`Kleur ${c}`}
        />
      ))}
    </div>
  );
}

export function ColorTempControl({ device }: { device: Device }) {
  const { sendCommand, busy, usable } = useControl(device);
  const [value, setValue] = useState(device.state.colorTempK ?? 2700);
  useEffect(() => {
    setValue(device.state.colorTempK ?? 2700);
  }, [device.state.colorTempK]);
  if (!supportsCommand(device, "set_color_temperature")) return null;
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] text-[#ffb36b]">Warm</span>
      <Slider
        value={[value]}
        min={2000}
        max={6500}
        step={100}
        disabled={!usable || busy}
        onValueChange={([v]) => setValue(v ?? value)}
        onValueCommit={([v]) => v && void sendCommand(device, { type: "set_color_temperature", colorTempK: v })}
        aria-label={`Kleurtemperatuur ${device.name}`}
      />
      <span className="text-[10px] text-[#cfe3ff]">Koel</span>
    </div>
  );
}

export function MediaControls({ device, size = "md" }: { device: Device; size?: "md" | "lg" }) {
  const { sendCommand, busy, usable } = useControl(device);
  const m = device.state.media;
  if (!supportsCommand(device, "media")) return null;
  const s = size === "lg" ? "icon" : "icon-sm";
  const playing = m?.playback === "playing";
  return (
    <div className="flex items-center gap-2">
      <Button size={s} variant="ghost" disabled={!usable || busy} onClick={() => void sendCommand(device, { type: "media", action: "previous" })} aria-label="Vorige">
        <SkipBack />
      </Button>
      <Button
        size={s}
        variant="primary"
        disabled={!usable || busy}
        onClick={() => void sendCommand(device, { type: "media", action: playing ? "pause" : "play" })}
        aria-label={playing ? "Pauzeren" : "Afspelen"}
        className="rounded-full"
      >
        {playing ? <Pause /> : <Play />}
      </Button>
      <Button size={s} variant="ghost" disabled={!usable || busy} onClick={() => void sendCommand(device, { type: "media", action: "next" })} aria-label="Volgende">
        <SkipForward />
      </Button>
      {supportsCommand(device, "media_power") && (
        <Button
          size={s}
          variant="ghost"
          disabled={!usable || busy}
          onClick={() => void sendCommand(device, { type: "media_power", on: m?.power !== "on" })}
          aria-label={m?.power === "on" ? "Naar stand-by" : "Aanzetten"}
          className={m?.power === "on" ? "text-success" : ""}
        >
          <Power />
        </Button>
      )}
    </div>
  );
}

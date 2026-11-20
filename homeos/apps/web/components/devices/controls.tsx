"use client";

import { useEffect, useState } from "react";
import { Minus, Pause, Play, Plus, Power, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
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
  return { sendCommand, busy: pending.has(device.id), usable, canAct: live && allowed };
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
  const { sendCommand, busy, usable, canAct } = useControl(device);
  const m = device.state.media;
  if (!supportsCommand(device, "media")) return null;
  const s = size === "lg" ? "icon" : "icon-sm";
  const playing = m?.playback === "playing";
  // Tv's (LG webOS) hebben geen vorige/volgende in hun API; die knoppen dan niet tonen.
  const isTv = device.integration === "lg_webos";
  // Een tv die uit staat is onbereikbaar, maar kan wel via het netwerk worden aangezet (Wake-on-LAN).
  const canWake = device.capabilities.includes("wake_on_lan") && device.status === "OFFLINE";
  const powerUsable = usable || (canWake && canAct);
  return (
    <div className="flex items-center gap-2">
      {!isTv && (
        <Button size={s} variant="ghost" disabled={!usable || busy} onClick={() => void sendCommand(device, { type: "media", action: "previous" })} aria-label="Vorige">
          <SkipBack />
        </Button>
      )}
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
      {!isTv && (
        <Button size={s} variant="ghost" disabled={!usable || busy} onClick={() => void sendCommand(device, { type: "media", action: "next" })} aria-label="Volgende">
          <SkipForward />
        </Button>
      )}
      {supportsCommand(device, "media_power") && (
        <Button
          size={s}
          variant="ghost"
          disabled={!powerUsable || busy}
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

/** Tv: volume, dempen en ingang/app kiezen. Toont alleen wat de tv zelf meldt. */
export function TvControls({ device }: { device: Device }) {
  const { sendCommand, busy, usable } = useControl(device);
  const m = device.state.media;
  const [volume, setVolume] = useState(m?.volume ?? 0);
  useEffect(() => {
    if (m?.volume !== undefined) setVolume(m.volume);
  }, [m?.volume]);
  const on = m?.power === "on";
  const hasVolume = supportsCommand(device, "set_volume") && on;
  const sources = m?.sources ?? [];
  const hasSources = supportsCommand(device, "select_source") && on && sources.length > 0;
  if (!hasVolume && !hasSources) return null;
  const disabled = !usable || busy;
  return (
    <div className="space-y-3">
      {hasVolume && (
        <div className="flex items-center gap-2">
          <Button size="icon-sm" variant="ghost" disabled={disabled} onClick={() => void sendCommand(device, { type: "set_mute", muted: !m?.muted })} aria-label={m?.muted ? "Geluid aan" : "Dempen"} aria-pressed={!!m?.muted}>
            {m?.muted ? <VolumeX /> : <Volume2 />}
          </Button>
          <Button size="icon-sm" variant="ghost" disabled={disabled} onClick={() => void sendCommand(device, { type: "volume_step", direction: "down" })} aria-label="Zachter">
            <Minus />
          </Button>
          {m?.volume !== undefined && (
            <Slider
              value={[volume]}
              min={0}
              max={100}
              step={1}
              disabled={disabled}
              onValueChange={([v]) => setVolume(v ?? volume)}
              onValueCommit={([v]) => v !== undefined && void sendCommand(device, { type: "set_volume", volume: v })}
              aria-label={`Volume ${device.name}`}
            />
          )}
          <Button size="icon-sm" variant="ghost" disabled={disabled} onClick={() => void sendCommand(device, { type: "volume_step", direction: "up" })} aria-label="Harder">
            <Plus />
          </Button>
          {m?.volume !== undefined && <span className="w-8 text-right text-xs tabular text-muted">{volume}</span>}
        </div>
      )}
      {hasSources && (
        <select
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm disabled:opacity-50"
          value={m?.source ?? ""}
          disabled={disabled}
          onChange={(e) => e.target.value && void sendCommand(device, { type: "select_source", sourceId: e.target.value })}
          aria-label={`Ingang of app op ${device.name}`}
        >
          {!m?.source && <option value="">Kies ingang of app…</option>}
          <optgroup label="Ingangen">
            {sources.filter((s) => s.type === "input").map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </optgroup>
          <optgroup label="Apps">
            {sources.filter((s) => s.type === "app").map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </optgroup>
        </select>
      )}
    </div>
  );
}

const MODE_LABEL: Record<string, string> = { cooling: "Koelen", heating: "Verwarmen", auto: "Auto", dry: "Drogen", fanOnly: "Ventileren" };
export const hvacModeLabel = (m: string | null | undefined) => (m ? (MODE_LABEL[m] ?? m) : "—");

/** Airco: modus en gewenste temperatuur, binnen wat de unit zelf meldt (min/max/stap). */
export function ClimateControl({ device }: { device: Device }) {
  const { sendCommand, busy, usable } = useControl(device);
  const c = device.state.climate;
  if (!c || !supportsCommand(device, "set_target_temperature")) return null;
  const step = c.stepC ?? 0.5;
  const set = (t: number) => {
    const v = Math.round(t / 0.5) * 0.5;
    if ((c.minTempC != null && v < c.minTempC) || (c.maxTempC != null && v > c.maxTempC)) return;
    void sendCommand(device, { type: "set_target_temperature", temperatureC: v });
  };
  const on = device.state.on !== false;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Button size="icon-sm" variant="secondary" disabled={!usable || busy || !on || c.targetTempC == null} onClick={() => set((c.targetTempC ?? 0) - step)} aria-label="Temperatuur lager">
          −
        </Button>
        <div className="text-center">
          <p className="text-2xl font-semibold tabular">{c.targetTempC != null ? `${c.targetTempC.toLocaleString("nl-NL")} °C` : "—"}</p>
          <p className="text-[11px] text-muted">{c.targetTempC == null ? "Geen setpoint in deze modus" : "Gewenst"}</p>
        </div>
        <Button size="icon-sm" variant="secondary" disabled={!usable || busy || !on || c.targetTempC == null} onClick={() => set((c.targetTempC ?? 0) + step)} aria-label="Temperatuur hoger">
          +
        </Button>
      </div>
      {c.modes.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Modus">
          {c.modes.map((m) => (
            <button
              key={m}
              disabled={!usable || busy}
              onClick={() => void sendCommand(device, { type: "set_hvac_mode", mode: m })}
              aria-pressed={c.mode === m}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition disabled:opacity-40",
                c.mode === m ? "border-accent bg-accent/15 text-fg" : "border-white/[0.08] text-muted hover:text-fg",
              )}
            >
              {hvacModeLabel(m)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

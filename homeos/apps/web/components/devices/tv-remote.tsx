"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronUp, FastForward, Home, Info, ListVideo, Menu, Pause, Play, Rewind, Square, Undo2, X } from "lucide-react";
import { supportsCommand, type Device, type RemoteButton } from "@homeos/shared";
import { Button, cn } from "@homeos/ui";
import { useCan } from "@/components/session-context";
import { useHome, useLive } from "@/lib/home-context";

const KEYMAP: Record<string, RemoteButton> = {
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  ArrowLeft: "LEFT",
  ArrowRight: "RIGHT",
  Enter: "ENTER",
  Backspace: "BACK",
  Escape: "EXIT",
  PageUp: "CHANNELUP",
  PageDown: "CHANNELDOWN",
};

/**
 * Virtuele afstandsbediening voor de tv. Bij een kastje op HDMI (zoals de Ziggo Next Mini) stuurt de tv de knoppen
 * via HDMI-CEC (SIMPLINK) door, als dat op tv en kastje aan staat. Toetsenbord: pijltjes, Enter, Backspace (terug).
 */
export function TvRemote({ device }: { device: Device }) {
  const { sendCommand } = useHome();
  const live = useLive();
  const allowed = useCan("control");
  const [numbers, setNumbers] = useState(false);
  if (!supportsCommand(device, "remote_button")) return null;
  const on = device.status === "ONLINE" && device.state.media?.power === "on";
  const disabled = !live || !allowed || !on;
  const press = (button: RemoteButton) => {
    if (!disabled) void sendCommand(device, { type: "remote_button", button });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const b = KEYMAP[e.key] ?? (/^[0-9]$/.test(e.key) ? (e.key as RemoteButton) : undefined);
    if (!b) return;
    e.preventDefault();
    press(b);
  };
  const k = (b: RemoteButton, label: string, icon: ReactNode) => (
    <Button type="button" size="icon" variant="secondary" disabled={disabled} onClick={() => press(b)} aria-label={label} className="rounded-full">
      {icon}
    </Button>
  );

  return (
    <div
      className="mx-auto w-full max-w-xs space-y-4 rounded-3xl border border-white/[0.06] bg-white/[0.02] p-4 outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      tabIndex={0}
      onKeyDown={onKey}
      role="group"
      aria-label={`Afstandsbediening ${device.name}`}
      data-testid="tv-remote"
    >
      {!on && (
        <p className="text-center text-xs text-muted">
          {device.integration === "ziggo"
            ? device.status === "OFFLINE"
              ? "De box staat in diepe stand-by en is niet via internet bereikbaar. Zet hem aan met de tv (HDMI-CEC) of zet op de box de energiemodus op snel opstarten."
              : "Zet de box aan met de aan/uit-knop hierboven om de afstandsbediening te gebruiken."
            : "Zet de tv aan om de afstandsbediening te gebruiken."}
        </p>
      )}
      <div className="flex justify-between">
        {k("BACK", "Terug", <Undo2 />)}
        {k("HOME", "Home", <Home />)}
        {k("MENU", "Menu", <Menu />)}
        {k("EXIT", "Sluiten", <X />)}
      </div>
      <div className="grid grid-cols-3 place-items-center gap-2">
        <span />
        {k("UP", "Omhoog", <ArrowUp />)}
        <span />
        {k("LEFT", "Links", <ArrowLeft />)}
        <Button type="button" size="icon" variant="primary" disabled={disabled} onClick={() => press("ENTER")} aria-label="OK" className="size-14 rounded-full text-sm font-semibold">
          OK
        </Button>
        {k("RIGHT", "Rechts", <ArrowRight />)}
        <span />
        {k("DOWN", "Omlaag", <ArrowDown />)}
        <span />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col items-center gap-1">
          {k("CHANNELUP", "Volgende zender", <ChevronUp />)}
          <span className="text-[10px] text-muted">CH</span>
          {k("CHANNELDOWN", "Vorige zender", <ChevronDown />)}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {k("INFO", "Info", <Info />)}
          {k("GUIDE", "Gids", <ListVideo />)}
          {k("REWIND", "Terugspoelen", <Rewind />)}
          {k("FASTFORWARD", "Vooruitspoelen", <FastForward />)}
          {k("PLAY", "Afspelen", <Play />)}
          {k("PAUSE", "Pauze", <Pause />)}
        </div>
        <div className="flex flex-col items-center gap-1">
          {k("STOP", "Stop", <Square />)}
        </div>
      </div>
      <div className="flex justify-center gap-2">
        {(["RED", "GREEN", "YELLOW", "BLUE"] as const).map((c) => (
          <button
            key={c}
            type="button"
            disabled={disabled}
            onClick={() => press(c)}
            aria-label={{ RED: "Rood", GREEN: "Groen", YELLOW: "Geel", BLUE: "Blauw" }[c]}
            className={cn("h-3 w-10 rounded-full disabled:opacity-40", { RED: "bg-red-500", GREEN: "bg-green-500", YELLOW: "bg-yellow-400", BLUE: "bg-blue-500" }[c])}
          />
        ))}
      </div>
      <button type="button" onClick={() => setNumbers((n) => !n)} className="w-full text-center text-xs text-muted hover:text-fg" aria-expanded={numbers}>
        {numbers ? "Cijfers verbergen" : "Cijfers tonen"}
      </button>
      {numbers && (
        <div className="grid grid-cols-3 gap-2">
          {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((n) => (
            <Button key={n} type="button" variant="secondary" disabled={disabled} onClick={() => press(n)} aria-label={`Toets ${n}`}>
              {n}
            </Button>
          ))}
          <span />
          <Button type="button" variant="secondary" disabled={disabled} onClick={() => press("0")} aria-label="Toets 0">
            0
          </Button>
        </div>
      )}
    </div>
  );
}

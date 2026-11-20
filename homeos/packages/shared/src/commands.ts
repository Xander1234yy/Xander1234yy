import { z } from "zod";
import { HexColorSchema, HvacModeSchema, type Capability, type Device } from "./device";

/** Toegestane tv-afstandsbedieningsknoppen (webOS-namen). Aan/uit en volume hebben eigen opdrachten. */
export const REMOTE_BUTTONS = [
  "UP", "DOWN", "LEFT", "RIGHT", "ENTER", "BACK", "HOME", "EXIT", "MENU", "INFO", "GUIDE", "LIST",
  "CHANNELUP", "CHANNELDOWN", "PLAY", "PAUSE", "STOP", "REWIND", "FASTFORWARD",
  "RED", "GREEN", "YELLOW", "BLUE", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
] as const;
export type RemoteButton = (typeof REMOTE_BUTTONS)[number];

export const DeviceCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_power"), on: z.boolean() }),
  z.object({ type: z.literal("set_brightness"), brightness: z.number().int().min(1).max(100) }),
  z.object({ type: z.literal("set_color"), colorHex: HexColorSchema }),
  z.object({ type: z.literal("set_color_temperature"), colorTempK: z.number().int().min(2000).max(6500) }),
  z.object({ type: z.literal("media"), action: z.enum(["play", "pause", "next", "previous"]) }),
  z.object({ type: z.literal("media_power"), on: z.boolean() }),
  z.object({ type: z.literal("set_hvac_mode"), mode: HvacModeSchema }),
  z.object({ type: z.literal("set_volume"), volume: z.number().int().min(0).max(100) }),
  z.object({ type: z.literal("volume_step"), direction: z.enum(["up", "down"]) }),
  z.object({ type: z.literal("set_mute"), muted: z.boolean() }),
  z.object({ type: z.literal("remote_button"), button: z.enum(REMOTE_BUTTONS) }),
  z.object({ type: z.literal("ptz_move"), direction: z.enum(["up", "down", "left", "right"]) }),
  z.object({ type: z.literal("select_source"), sourceId: z.string().min(1).max(200).regex(/^[\w.:-]+$/, "Ongeldige bron") }),
  z.object({
    type: z.literal("set_target_temperature"),
    temperatureC: z.number().min(10).max(32).refine((v) => Number.isInteger(v * 2), "Stappen van 0,5 °C"),
  }),
]);
export type DeviceCommand = z.infer<typeof DeviceCommandSchema>;

export const COMMAND_SOURCES = ["user", "automation", "jarvis"] as const;
export const CommandSourceSchema = z.enum(COMMAND_SOURCES);
export type CommandSource = z.infer<typeof CommandSourceSchema>;

export const CommandRequestSchema = z.object({
  command: DeviceCommandSchema,
  source: CommandSourceSchema.default("user"),
});
export type CommandRequest = z.infer<typeof CommandRequestSchema>;

/** Welke capability is minimaal nodig om een opdracht aan te bieden of uit te voeren. */
export const COMMAND_CAPABILITY: Record<DeviceCommand["type"], Capability> = {
  set_power: "onoff",
  set_brightness: "brightness",
  set_color: "color",
  set_color_temperature: "color_temperature",
  media: "media_playback",
  media_power: "media_power",
  set_hvac_mode: "climate",
  set_target_temperature: "climate",
  set_volume: "volume",
  volume_step: "volume",
  set_mute: "volume",
  select_source: "source_select",
  ptz_move: "ptz",
  remote_button: "remote_control",
};

/**
 * Apparaattypen die nooit door automatiseringen of Jarvis zelfstandig bediend mogen worden.
 * (Veiligheidskritisch of privacygevoelig.)
 */
export const SAFETY_CRITICAL_KINDS = new Set<Device["kind"]>(["doorbell", "bridge", "energy_meter", "solar_inverter", "camera"]);

export type CommandCheck = { ok: true } | { ok: false; code: CommandErrorCode; reason: string };

export type CommandErrorCode =
  | "NOT_FOUND"
  | "UNSUPPORTED"
  | "DEVICE_UNAVAILABLE"
  | "EMERGENCY_STOP"
  | "FORBIDDEN"
  | "ADAPTER_ERROR"
  | "INVALID";

/** Pure controle, gedeeld door connector (afdwingen) en frontend (alleen tonen wat kan). */
export function checkCommand(
  device: Pick<Device, "capabilities" | "status" | "kind" | "name">,
  command: DeviceCommand,
  opts: { source: CommandSource; emergencyStop: boolean },
): CommandCheck {
  const needed = COMMAND_CAPABILITY[command.type];
  if (!device.capabilities.includes(needed)) {
    return { ok: false, code: "UNSUPPORTED", reason: `${device.name} ondersteunt '${needed}' niet.` };
  }
  if (opts.source !== "user") {
    if (opts.emergencyStop) {
      return { ok: false, code: "EMERGENCY_STOP", reason: "Noodstop actief: automatische opdrachten zijn gepauzeerd." };
    }
    if (SAFETY_CRITICAL_KINDS.has(device.kind)) {
      return { ok: false, code: "FORBIDDEN", reason: `${device.name} mag niet automatisch bediend worden.` };
    }
  }
  // Aanzetten via het netwerk (Wake-on-LAN) kan juist wanneer het apparaat uit en dus onbereikbaar is.
  const wake = command.type === "media_power" && command.on && device.capabilities.includes("wake_on_lan") && device.status === "OFFLINE";
  if (device.status !== "ONLINE" && !wake) {
    return { ok: false, code: "DEVICE_UNAVAILABLE", reason: `${device.name} is niet online (${device.status}).` };
  }
  return { ok: true };
}

export function supportsCommand(device: Pick<Device, "capabilities">, type: DeviceCommand["type"]): boolean {
  return device.capabilities.includes(COMMAND_CAPABILITY[type]);
}

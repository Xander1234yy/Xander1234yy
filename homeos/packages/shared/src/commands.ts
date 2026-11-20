import { z } from "zod";
import { HexColorSchema, type Capability, type Device } from "./device";

export const DeviceCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_power"), on: z.boolean() }),
  z.object({ type: z.literal("set_brightness"), brightness: z.number().int().min(1).max(100) }),
  z.object({ type: z.literal("set_color"), colorHex: HexColorSchema }),
  z.object({ type: z.literal("set_color_temperature"), colorTempK: z.number().int().min(2000).max(6500) }),
  z.object({ type: z.literal("media"), action: z.enum(["play", "pause", "next", "previous"]) }),
  z.object({ type: z.literal("media_power"), on: z.boolean() }),
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
};

/**
 * Apparaattypen die nooit door automatiseringen of Jarvis zelfstandig bediend mogen worden.
 * (Veiligheidskritisch of privacygevoelig.)
 */
export const SAFETY_CRITICAL_KINDS = new Set<Device["kind"]>(["doorbell", "bridge", "energy_meter", "solar_inverter"]);

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
  if (device.status !== "ONLINE") {
    return { ok: false, code: "DEVICE_UNAVAILABLE", reason: `${device.name} is niet online (${device.status}).` };
  }
  return { ok: true };
}

export function supportsCommand(device: Pick<Device, "capabilities">, type: DeviceCommand["type"]): boolean {
  return device.capabilities.includes(COMMAND_CAPABILITY[type]);
}

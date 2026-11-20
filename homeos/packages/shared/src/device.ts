import { z } from "zod";

/** Verbindingsstatus van een apparaat. Nooit "ONLINE" tonen op basis van oude gegevens. */
export const DEVICE_STATUSES = ["ONLINE", "OFFLINE", "CONNECTING", "ERROR", "UNKNOWN"] as const;
export const DeviceStatusSchema = z.enum(DEVICE_STATUSES);
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;

export const CAPABILITIES = [
  "onoff",
  "brightness",
  "color",
  "color_temperature",
  "power_metering",
  "energy_production",
  "energy_grid",
  "media_playback",
  "media_power",
  "doorbell",
  "motion",
  "battery",
] as const;
export const CapabilitySchema = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof CapabilitySchema>;

export const INTEGRATION_TYPES = ["demo", "philips_hue", "smart_plug", "apple_tv", "solar", "doorbell"] as const;
export const IntegrationTypeSchema = z.enum(INTEGRATION_TYPES);
export type IntegrationType = z.infer<typeof IntegrationTypeSchema>;

export const DEVICE_KINDS = ["light", "plug", "media", "solar_inverter", "energy_meter", "doorbell", "bridge"] as const;
export const DeviceKindSchema = z.enum(DEVICE_KINDS);
export type DeviceKind = z.infer<typeof DeviceKindSchema>;

const isoDate = z.iso.datetime({ offset: true });
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Kleur moet #RRGGBB zijn");

export const MediaStateSchema = z.object({
  power: z.enum(["on", "standby", "unknown"]),
  playback: z.enum(["playing", "paused", "idle", "unknown"]),
  app: z.string().max(120).optional(),
  title: z.string().max(240).optional(),
  artist: z.string().max(240).optional(),
});
export type MediaState = z.infer<typeof MediaStateSchema>;

/** Laatst bekende toestand. Alle velden optioneel: alleen wat het apparaat werkelijk rapporteert. */
export const DeviceStateSchema = z.object({
  on: z.boolean().optional(),
  brightness: z.number().min(0).max(100).optional(),
  colorHex: HexColorSchema.optional(),
  colorTempK: z.number().min(1000).max(10000).optional(),
  powerW: z.number().optional(),
  energyTodayKwh: z.number().min(0).optional(),
  productionW: z.number().min(0).optional(),
  media: MediaStateSchema.optional(),
  batteryPct: z.number().min(0).max(100).optional(),
  lastRingAt: isoDate.optional(),
  lastMotionAt: isoDate.optional(),
});
export type DeviceState = z.infer<typeof DeviceStateSchema>;

export const DeviceSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(80),
  brand: z.string().max(80),
  model: z.string().max(120),
  kind: DeviceKindSchema,
  roomId: z.string().nullable(),
  integration: IntegrationTypeSchema,
  adapterId: z.string(),
  status: DeviceStatusSchema,
  /** Laatste moment waarop het apparaat werkelijk reageerde. */
  lastSeen: isoDate.nullable(),
  /** Moment waarop `state` voor het laatst is uitgelezen. */
  stateUpdatedAt: isoDate.nullable(),
  capabilities: z.array(CapabilitySchema),
  state: DeviceStateSchema,
  error: z.string().nullable(),
  /** true = gesimuleerd DEMO-apparaat, nooit een echt apparaat. */
  demo: z.boolean(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const SceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  roomId: z.string().nullable(),
  adapterId: z.string(),
  demo: z.boolean(),
});
export type Scene = z.infer<typeof SceneSchema>;

export const RoomSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  icon: z.string().max(40),
  order: z.number().int(),
});
export type Room = z.infer<typeof RoomSchema>;

export const DEVICE_EVENT_TYPES = ["doorbell_ring", "motion", "status_change", "command", "error"] as const;
export const DeviceEventSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  type: z.enum(DEVICE_EVENT_TYPES),
  at: isoDate,
  message: z.string(),
  demo: z.boolean(),
});
export type DeviceEvent = z.infer<typeof DeviceEventSchema>;

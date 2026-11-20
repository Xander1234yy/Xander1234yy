import { z } from "zod";
import { DeviceEventSchema, DeviceSchema, RoomSchema, SceneSchema } from "./device";

export const AdapterHealthSchema = z.object({
  adapterId: z.string(),
  integration: z.string(),
  displayName: z.string(),
  demo: z.boolean(),
  status: z.enum(["ok", "degraded", "down", "not_configured"]),
  message: z.string().nullable(),
  checkedAt: z.iso.datetime({ offset: true }),
});
export type AdapterHealth = z.infer<typeof AdapterHealthSchema>;

export const ConnectorInfoSchema = z.object({
  connectorId: z.string(),
  version: z.string(),
  startedAt: z.iso.datetime({ offset: true }),
  demoMode: z.boolean(),
  emergencyStop: z.boolean(),
  adapters: z.array(AdapterHealthSchema),
});
export type ConnectorInfo = z.infer<typeof ConnectorInfoSchema>;

export const SnapshotSchema = z.object({
  generatedAt: z.iso.datetime({ offset: true }),
  connector: ConnectorInfoSchema,
  devices: z.array(DeviceSchema),
  rooms: z.array(RoomSchema),
  scenes: z.array(SceneSchema),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const ConnectorMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), data: SnapshotSchema }),
  z.object({ type: z.literal("event"), data: DeviceEventSchema }),
]);
export type ConnectorMessage = z.infer<typeof ConnectorMessageSchema>;

export const RoomInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().trim().max(40).optional(),
});

export const DevicePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    roomId: z.string().max(64).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.roomId !== undefined, "Niets om te wijzigen");

export const DeviceAddSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  roomId: z.string().max(64).nullable().optional(),
});

export const SceneActivateSchema = z.object({ source: z.enum(["user", "automation", "jarvis"]).default("user") });

export const EmergencyStopSchema = z.object({ active: z.boolean() });

export type ApiError = { error: { code: string; message: string } };

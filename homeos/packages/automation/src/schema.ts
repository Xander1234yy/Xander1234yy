import { z } from "zod";
import { DeviceCommandSchema } from "@homeos/shared";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Tijd als UU:MM");
const days = z.array(z.number().int().min(0).max(6)).max(7); // 0 = zondag
const op = z.enum(["eq", "gt", "lt"]);
export const DEVICE_PROPERTIES = ["on", "powerW", "productionW", "roomTempC", "brightness"] as const;
export const ENERGY_METRICS = ["productionW", "consumptionW", "gridImportW", "gridExportW"] as const;
export const NOTIFICATION_CATEGORIES = ["connection", "energy", "maintenance", "automation", "security", "system"] as const;

export const TriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("time"), at: hhmm, days: days.default([]) }),
  z.object({ type: z.literal("device_state"), deviceId: z.string().min(1).max(200), property: z.enum(DEVICE_PROPERTIES), op, value: z.union([z.number(), z.boolean()]) }),
  z.object({ type: z.literal("energy"), metric: z.enum(ENERGY_METRICS), op: z.enum(["gt", "lt"]), value: z.number().min(0).max(1_000_000) }),
  z.object({ type: z.literal("device_offline"), deviceId: z.string().min(1).max(200), forMinutes: z.number().int().min(1).max(1440) }),
  z.object({ type: z.literal("manual") }),
]);
export type Trigger = z.infer<typeof TriggerSchema>;

export const ConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("time_between"), from: hhmm, to: hhmm }),
  z.object({ type: z.literal("weekday"), days: days.min(1) }),
  z.object({ type: z.literal("device_online"), deviceId: z.string().min(1).max(200) }),
  z.object({ type: z.literal("device_state"), deviceId: z.string().min(1).max(200), property: z.enum(DEVICE_PROPERTIES), op, value: z.union([z.number(), z.boolean()]) }),
  z.object({ type: z.literal("energy"), metric: z.enum(ENERGY_METRICS), op: z.enum(["gt", "lt"]), value: z.number() }),
]);
export type Condition = z.infer<typeof ConditionSchema>;

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("scene"), sceneId: z.string().min(1).max(200) }),
  z.object({ type: z.literal("device_command"), deviceId: z.string().min(1).max(200), command: DeviceCommandSchema }),
  z.object({ type: z.literal("notify"), category: z.enum(NOTIFICATION_CATEGORIES).default("automation"), title: z.string().trim().min(1).max(120), message: z.string().max(1000).default("") }),
  z.object({ type: z.literal("report"), kind: z.enum(["evening", "energy"]) }),
  z.object({ type: z.literal("delay"), minutes: z.number().int().min(1).max(60) }),
]);
export type Action = z.infer<typeof ActionSchema>;

export const AutomationInputSchema = z.object({
  name: z.string().trim().min(1, "Naam is verplicht").max(80),
  enabled: z.boolean().default(true),
  trigger: TriggerSchema,
  conditions: z.array(ConditionSchema).max(10).default([]),
  actions: z.array(ActionSchema).min(1, "Minimaal één actie").max(10),
  cooldownMinutes: z.number().int().min(0).max(1440).default(5),
  maxRunsPerDay: z.number().int().min(1).max(100).default(20),
});
export type AutomationInput = z.infer<typeof AutomationInputSchema>;

export const AutomationSchema = AutomationInputSchema.extend({
  id: z.uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Automation = z.infer<typeof AutomationSchema>;

export type RunStatus = "running" | "succeeded" | "failed" | "skipped" | "blocked";
export interface RunStep {
  action: Action["type"];
  ok: boolean;
  message: string;
}
export interface AutomationRun {
  id: string;
  automationId: string;
  automationName: string;
  trigger: Trigger["type"];
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  steps: RunStep[];
  error: string | null;
}

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export interface HomeNotification {
  id: string;
  at: string;
  category: NotificationCategory;
  title: string;
  body: string;
  read: boolean;
}

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  connection: "Verbinding",
  energy: "Energie",
  maintenance: "Onderhoud",
  automation: "Automatiseringen",
  security: "Beveiliging",
  system: "Systeem",
};

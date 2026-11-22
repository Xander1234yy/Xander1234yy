import type { Device, DeviceCommand, EnergyHistory, EnergySummary, Snapshot } from "@homeos/shared";

export interface FamilyContext {
  shopping: { name: string; quantity: string }[];
  openTasks: number;
  upcoming: { title: string; starts_at: string; all_day: boolean }[];
  canWrite: boolean;
}

export interface AutomationInfo {
  id: string;
  name: string;
  enabled: boolean;
}

/** Wat Jarvis van het vorige gespreksbeurt onthoudt (de browser stuurt het terug; de server is stateless). */
export interface JarvisMemory {
  deviceIds: string[];
  roomId: string | null;
}

export interface JarvisContext {
  snapshot: Snapshot | null;
  energy: EnergySummary | null;
  energyWeek?: EnergyHistory | null;
  connectorOnline: boolean;
  family?: FamilyContext;
  automations?: AutomationInfo[];
  memory?: JarvisMemory | null;
  now?: Date;
  canControl?: boolean;
  /** Pauzeren/activeren van automatiseringen vereist manage_automations (admin+). */
  canManageAutomations?: boolean;
}

export type JarvisAction =
  | { kind: "command"; deviceId: string; deviceName: string; command: DeviceCommand; label: string }
  | { kind: "scene"; sceneId: string; sceneName: string; label: string }
  | { kind: "shopping_add"; name: string; label: string }
  | { kind: "task_add"; title: string; label: string }
  | { kind: "create_automation"; template: "evening" | "energy" | "offline"; label: string }
  | { kind: "automation_run"; automationId: string; label: string }
  | { kind: "automation_toggle"; automationId: string; enabled: boolean; label: string };

export interface JarvisReply {
  intent: string;
  text: string;
  actions: JarvisAction[];
  provider: string;
  memory?: JarvisMemory;
}

/**
 * Provider-interface: iedere "hersenen" voor Jarvis (lokaal, of later een AI-model) implementeert dit.
 * Een provider doet uitsluitend voorstellen; uitvoeren gebeurt na bevestiging via de gecontroleerde connector-API.
 */
export interface JarvisProvider {
  readonly id: string;
  readonly name: string;
  readonly requiresNetwork: boolean;
  respond(message: string, ctx: JarvisContext): Promise<JarvisReply>;
}

export type { Device };

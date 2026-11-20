import type {
  AdapterHealth,
  Capability,
  DeviceCommand,
  DeviceEvent,
  DeviceKind,
  DeviceState,
  DeviceStatus,
  EnergyHistory,
  EnergyRange,
  EnergySummary,
  IntegrationType,
  Scene,
} from "@homeos/shared";

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export type AdapterEvent =
  | { type: "device_state"; externalId: string; report: StatusReport }
  | { type: "device_event"; externalId: string; event: Omit<DeviceEvent, "id" | "deviceId" | "demo"> }
  | { type: "devices_changed" };

export interface AdapterContext {
  logger: Logger;
  now(): Date;
  emit(event: AdapterEvent): void;
  /** Versleutelde, uitsluitend lokale opslag voor tokens van deze adapter. */
  secrets: SecretAccess;
}

export interface SecretAccess {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Wat een adapter over een gevonden apparaat weet. Registry-velden (naam-override, kamer) komen later. */
export interface DiscoveredDevice {
  externalId: string;
  name: string;
  brand: string;
  model: string;
  kind: DeviceKind;
  capabilities: Capability[];
  suggestedRoomId: string | null;
  /** Verversingsinterval van de bron (ms), voor de versheidsweergave. */
  refreshIntervalMs?: number;
}

export interface StatusReport {
  status: DeviceStatus;
  state: DeviceState;
  /** ISO-tijd waarop het apparaat werkelijk reageerde, null als het nooit reageerde. */
  lastSeen: string | null;
  error: string | null;
  /** Tijdstip waarop de bron deze toestand mat (cloud-API's). Zonder deze waarde geldt "nu". */
  stateAt?: string | null;
}

export type CommandResult =
  | { ok: true; report: StatusReport }
  | { ok: false; code: "UNSUPPORTED" | "DEVICE_UNAVAILABLE" | "ADAPTER_ERROR" | "NOT_FOUND"; message: string };

export interface EnergyProvider {
  /**
   * "production": alleen opwek (zonnepanelen). "grid": alleen net/meter (P1). "full" (standaard): alles.
   * Bij een combinatie van opwek en meter rekent de registry het eigen verbruik uit: opwek + afname − teruglevering.
   */
  role?: "production" | "grid" | "full";
  getSummary(): Promise<EnergySummary>;
  getHistory(range: EnergyRange): Promise<EnergyHistory>;
}

/**
 * Basisinterface die iedere integratie implementeert (Hue, stekkers, Apple TV, zonnepanelen, deurbel, demo).
 * Adapters draaien uitsluitend in de lokale Device Connector — nooit in de browser of cloud.
 */
export interface DeviceAdapter {
  readonly id: string;
  readonly integration: IntegrationType;
  readonly displayName: string;
  readonly demo: boolean;

  connect(ctx: AdapterContext): Promise<void>;
  disconnect(): Promise<void>;
  discover(): Promise<DiscoveredDevice[]>;
  getStatus(externalId: string): Promise<StatusReport>;
  executeCommand(externalId: string, command: DeviceCommand): Promise<CommandResult>;
  getCapabilities(externalId: string): Capability[];
  healthCheck(): Promise<AdapterHealth>;

  /** Optioneel: scènes (Hue). */
  getScenes?(): Promise<Omit<Scene, "adapterId" | "demo">[]>;
  activateScene?(sceneId: string): Promise<{ ok: true } | { ok: false; message: string }>;
  /** Optioneel: energiebron (zonnepanelen / slimme meter). */
  energy?: EnergyProvider;
}

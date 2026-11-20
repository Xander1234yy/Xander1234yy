import type { AdapterHealth, Capability, DeviceCommand, DeviceState, DeviceStatus } from "@homeos/shared";
import { COMMAND_CAPABILITY } from "@homeos/shared";
import type {
  AdapterContext,
  CommandResult,
  DeviceAdapter,
  DiscoveredDevice,
  StatusReport,
} from "../adapter";

export interface DemoDevice {
  info: DiscoveredDevice;
  state: DeviceState;
  status: DeviceStatus;
  lastSeen: string | null;
  error: string | null;
}

/**
 * Basis voor DEMO-adapters. Alles is gesimuleerd en wordt overal als DEMO gemarkeerd.
 * Wordt nooit geladen tenzij de connector expliciet in demo-modus draait.
 */
export abstract class DemoAdapterBase implements DeviceAdapter {
  abstract readonly id: string;
  abstract readonly integration: DeviceAdapter["integration"];
  abstract readonly displayName: string;
  readonly demo = true;

  protected ctx: AdapterContext | null = null;
  protected readonly devices = new Map<string, DemoDevice>();
  private timers: ReturnType<typeof setInterval>[] = [];

  protected abstract seed(): DemoDevice[];
  protected abstract apply(device: DemoDevice, command: DeviceCommand): void;
  /** Periodieke simulatie (optioneel). */
  protected tick?(): void;
  protected tickMs = 5_000;

  async connect(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    const now = ctx.now().toISOString();
    for (const d of this.seed()) {
      if (d.status === "ONLINE") d.lastSeen = now;
      this.devices.set(d.info.externalId, d);
    }
    if (ctx.serverless) {
      // Cloudmodus: DEMO-toestand bewaren tussen aanvragen (geen timers).
      const saved = (await ctx.cache?.load()) as Record<string, Pick<DemoDevice, "state" | "status">> | null;
      for (const [id, v] of Object.entries(saved ?? {})) {
        const d = this.devices.get(id);
        if (d && v) Object.assign(d, { state: v.state, status: v.status });
      }
      return;
    }
    if (this.tick) {
      const t = setInterval(() => this.tick?.(), this.tickMs);
      t.unref?.();
      this.timers.push(t);
    }
  }

  async disconnect(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.ctx = null;
  }

  async discover(): Promise<DiscoveredDevice[]> {
    return [...this.devices.values()].map((d) => d.info);
  }

  async getStatus(externalId: string): Promise<StatusReport> {
    const d = this.devices.get(externalId);
    if (!d) return { status: "UNKNOWN", state: {}, lastSeen: null, error: "Onbekend apparaat" };
    if (d.status === "ONLINE") d.lastSeen = this.nowIso();
    return this.report(d);
  }

  async executeCommand(externalId: string, command: DeviceCommand): Promise<CommandResult> {
    const d = this.devices.get(externalId);
    if (!d) return { ok: false, code: "NOT_FOUND", message: "Onbekend apparaat" };
    if (!d.info.capabilities.includes(COMMAND_CAPABILITY[command.type])) {
      return { ok: false, code: "UNSUPPORTED", message: `Opdracht ${command.type} niet ondersteund` };
    }
    if (d.status !== "ONLINE") {
      return { ok: false, code: "DEVICE_UNAVAILABLE", message: `${d.info.name} reageert niet` };
    }
    this.apply(d, command);
    d.lastSeen = this.nowIso();
    if (this.ctx?.serverless) await this.ctx.cache?.save(Object.fromEntries([...this.devices].map(([id, x]) => [id, { state: x.state, status: x.status }])));
    return { ok: true, report: this.report(d) };
  }

  getCapabilities(externalId: string): Capability[] {
    return this.devices.get(externalId)?.info.capabilities ?? [];
  }

  async healthCheck(): Promise<AdapterHealth> {
    return {
      adapterId: this.id,
      integration: this.integration,
      displayName: this.displayName,
      demo: true,
      status: this.ctx ? "ok" : "down",
      message: this.ctx ? "DEMO: gesimuleerde apparaten" : "Niet verbonden",
      checkedAt: this.nowIso(),
    };
  }

  protected nowIso(): string {
    return (this.ctx?.now() ?? new Date()).toISOString();
  }

  protected report(d: DemoDevice): StatusReport {
    return { status: d.status, state: structuredClone(d.state), lastSeen: d.lastSeen, error: d.error };
  }

  protected push(d: DemoDevice): void {
    if (d.status === "ONLINE") d.lastSeen = this.nowIso();
    this.ctx?.emit({ type: "device_state", externalId: d.info.externalId, report: this.report(d) });
  }
}

export function demoDevice(
  info: Omit<DiscoveredDevice, "brand"> & { brand?: string },
  state: DeviceState,
  status: DeviceStatus = "ONLINE",
  error: string | null = null,
): DemoDevice {
  return { info: { brand: "HomeOS Demo", ...info }, state, status, lastSeen: null, error };
}

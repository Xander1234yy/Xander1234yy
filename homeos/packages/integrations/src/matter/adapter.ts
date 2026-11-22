import { COMMAND_CAPABILITY, type AdapterHealth, type Capability, type DeviceCommand, type DeviceState } from "@homeos/shared";
import type { AdapterContext, CommandResult, DeviceAdapter, DiscoveredDevice, StatusReport } from "../adapter";

/**
 * Matter (open standaard van de CSA). HomeOS is hierbij een Matter-controller met een eigen "fabric"; apparaten
 * worden gedeeld via multi-admin (bijv. IKEA Home smart → "Bediening in andere systemen" → koppelcode).
 * Communicatie is volledig lokaal (IPv6, ook via een Thread-border-router zoals de DIRIGERA).
 *
 * De netwerkkant zit achter MatterBackend, zodat deze adapter zonder echte Matter-stack te testen is.
 */
export interface MatterEndpointInfo {
  endpoint: number;
  kind: "plug" | "light";
  name: string | null;
  onOff: boolean | null;
  level: number | null; // 0-254 (LevelControl), null als niet aanwezig
  activePowerW: number | null;
}
export interface MatterNodeInfo {
  nodeId: string;
  vendorName: string;
  productName: string;
  nodeLabel: string;
  online: boolean;
  endpoints: MatterEndpointInfo[];
}
export interface MatterBackend {
  start(onChange: () => void): Promise<void>;
  stop(): Promise<void>;
  commission(pairingCode: string): Promise<string>;
  nodes(): MatterNodeInfo[];
  setOnOff(nodeId: string, endpoint: number, on: boolean): Promise<void>;
  setLevel(nodeId: string, endpoint: number, level: number): Promise<void>;
  remove(nodeId: string): Promise<void>;
}

/** Handmatige Matter-koppelcode (11 of 21 cijfers, met of zonder streepjes/spaties) of QR-code ("MT:…"). */
export function normalizePairingCode(input: string): string | null {
  const s = input.trim();
  if (/^MT:[0-9A-Z.-]{19,}$/.test(s)) return s;
  const digits = s.replace(/[\s-]/g, "");
  return /^\d{11}$|^\d{21}$/.test(digits) ? digits : null;
}

export class MatterStackError extends Error {}

const extId = (nodeId: string, ep: number) => `${nodeId}-${ep}`;

export class MatterAdapter implements DeviceAdapter {
  readonly integration = "smart_plug" as const;
  readonly demo = false;
  readonly id = "matter";
  readonly displayName = "Matter (o.a. IKEA)";
  private ctx: AdapterContext | null = null;
  private started = false;
  private lastError: string | null = null;
  private known = new Set<string>();

  constructor(readonly backend: MatterBackend) {}

  async connect(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    try {
      await this.backend.start(() => this.onChange());
      this.started = true;
      this.lastError = null;
    } catch (err) {
      this.lastError = `Matter-stack kon niet starten: ${err instanceof Error ? err.message : String(err)}`;
      ctx.logger.error("Matter starten mislukt", { error: this.lastError });
    }
  }

  async disconnect(): Promise<void> {
    if (this.started) await this.backend.stop().catch(() => undefined);
    this.started = false;
    this.ctx = null;
  }

  private onChange(): void {
    const ids = new Set(this.backend.nodes().flatMap((n) => n.endpoints.map((e) => extId(n.nodeId, e.endpoint))));
    if (ids.size !== this.known.size || [...ids].some((i) => !this.known.has(i))) {
      this.known = ids;
      this.ctx?.emit({ type: "devices_changed" });
    }
    for (const id of ids) this.ctx?.emit({ type: "device_state", externalId: id, report: this.report(id) });
  }

  private find(externalId: string): { node: MatterNodeInfo; ep: MatterEndpointInfo } | null {
    for (const node of this.backend.nodes()) for (const ep of node.endpoints) if (extId(node.nodeId, ep.endpoint) === externalId) return { node, ep };
    return null;
  }

  async commission(pairingCode: string): Promise<string> {
    const code = normalizePairingCode(pairingCode);
    if (!code) throw new Error("Ongeldige koppelcode: gebruik de 11-cijferige code uit de app (of de MT:-code)");
    if (!this.started && this.ctx) await this.connect(this.ctx); // nieuwe poging (bijv. na netwerkwijziging)
    if (!this.started) throw new MatterStackError(this.lastError ?? "Matter is niet gestart");
    const nodeId = await this.backend.commission(code);
    this.onChange();
    return nodeId;
  }

  async removeNode(nodeId: string): Promise<void> {
    await this.backend.remove(nodeId);
    this.onChange();
  }

  getCapabilities(externalId: string): Capability[] {
    const f = this.find(externalId);
    if (!f) return [];
    const caps: Capability[] = [];
    if (f.ep.onOff !== null) caps.push("onoff");
    if (f.ep.level !== null) caps.push("brightness");
    if (f.ep.activePowerW !== null) caps.push("power_metering");
    return caps;
  }

  async discover(): Promise<DiscoveredDevice[]> {
    return this.backend.nodes().flatMap((n) =>
      n.endpoints.map((ep) => ({
        externalId: extId(n.nodeId, ep.endpoint),
        name: (ep.name || n.nodeLabel || n.productName || "Matter-apparaat").slice(0, 80),
        brand: (n.vendorName || "Matter").slice(0, 80),
        model: (n.productName || "").slice(0, 120),
        kind: ep.kind,
        capabilities: this.getCapabilities(extId(n.nodeId, ep.endpoint)),
        suggestedRoomId: null,
      })),
    );
  }

  private report(externalId: string): StatusReport {
    const f = this.find(externalId);
    if (!f) return { status: "UNKNOWN", state: {}, lastSeen: null, error: "Niet gevonden in de Matter-fabric van HomeOS" };
    const state: DeviceState = {};
    if (f.ep.onOff !== null) state.on = f.ep.onOff;
    if (f.ep.level !== null) state.brightness = Math.max(1, Math.round((f.ep.level / 254) * 100));
    if (f.ep.activePowerW !== null) state.powerW = Math.round(f.ep.activePowerW * 10) / 10;
    if (!f.node.online) return { status: "OFFLINE", state, lastSeen: null, error: "Niet bereikbaar via Matter (stroom, Thread-netwerk of DIRIGERA?)" };
    return { status: "ONLINE", state, lastSeen: new Date().toISOString(), error: null };
  }

  async getStatus(externalId: string): Promise<StatusReport> {
    return this.report(externalId);
  }

  async executeCommand(externalId: string, command: DeviceCommand): Promise<CommandResult> {
    const f = this.find(externalId);
    if (!f) return { ok: false, code: "NOT_FOUND", message: "Apparaat niet gevonden" };
    if (!this.getCapabilities(externalId).includes(COMMAND_CAPABILITY[command.type])) return { ok: false, code: "UNSUPPORTED", message: "Niet ondersteund door dit Matter-apparaat" };
    if (!f.node.online) return { ok: false, code: "DEVICE_UNAVAILABLE", message: "Het apparaat is niet bereikbaar via Matter" };
    try {
      if (command.type === "set_power") await this.backend.setOnOff(f.node.nodeId, f.ep.endpoint, command.on);
      else if (command.type === "set_brightness") await this.backend.setLevel(f.node.nodeId, f.ep.endpoint, Math.round((command.brightness / 100) * 254));
      else return { ok: false, code: "UNSUPPORTED", message: "Niet ondersteund" };
    } catch (err) {
      return { ok: false, code: "ADAPTER_ERROR", message: `Matter-opdracht mislukt: ${err instanceof Error ? err.message : String(err)}` };
    }
    // De backend werkt de status bij via de Matter-subscriptie; we geven de actuele lokale weergave terug.
    return { ok: true, report: this.report(externalId) };
  }

  async healthCheck(): Promise<AdapterHealth> {
    const nodes = this.started ? this.backend.nodes() : [];
    return {
      adapterId: this.id,
      integration: this.integration,
      displayName: this.displayName,
      demo: false,
      status: this.lastError ? "down" : nodes.length ? "ok" : "not_configured",
      message: this.lastError ?? (nodes.length ? `${nodes.length} Matter-apparaat/apparaten (experimenteel)` : "Nog geen Matter-apparaten gekoppeld (experimenteel)"),
      checkedAt: new Date().toISOString(),
    };
  }
}

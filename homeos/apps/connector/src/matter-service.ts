import path from "node:path";
import { MatterAdapter, MatterStackError, type Logger, type MatterBackend } from "@homeos/integrations";
import type { DeviceRegistry } from "./registry";
import type { IntegrationsStore } from "./integrations-store";
import { SetupError } from "./cloud-service";

export type MatterBackendFactory = (storageDir: string, logger: Logger) => MatterBackend;

/** Laadt matter.js pas bij start (dynamic import), zodat de connector zonder Matter licht blijft. */
export const lazyMatterJsBackend: MatterBackendFactory = (storageDir, logger) => {
  let inner: MatterBackend | null = null;
  return {
    async start(onChange) {
      const { createMatterJsBackend } = await import("./matter-backend");
      inner = await createMatterJsBackend(storageDir, logger);
      await inner.start(onChange);
    },
    stop: async () => inner?.stop(),
    commission: (code) => inner!.commission(code),
    nodes: () => inner?.nodes() ?? [],
    setOnOff: (n, e, on) => inner!.setOnOff(n, e, on),
    setLevel: (n, e, l) => inner!.setLevel(n, e, l),
    remove: (n) => inner!.remove(n),
  };
};

export function createMatterService(o: { registry: DeviceRegistry; store: IntegrationsStore; dataDir: string; logger: Logger; factory: MatterBackendFactory }) {
  let adapter: MatterAdapter | null = null;
  const make = () => (adapter = new MatterAdapter(o.factory(path.join(o.dataDir, "matter"), o.logger)));

  return {
    adapters() {
      return o.store.state.matter ? [make()] : [];
    },
    list() {
      if (!o.store.state.matter) return null;
      const nodes = adapter ? (adapter as unknown as { backend: MatterBackend }).backend.nodes() : [];
      return {
        enabledAt: o.store.state.matter.enabledAt,
        health: o.registry.adapterHealth("matter"),
        nodes: nodes.map((n) => ({ nodeId: n.nodeId, vendorName: n.vendorName, productName: n.productName, online: n.online, endpoints: n.endpoints.length })),
      };
    },
    async commission(pairingCode: string) {
      if (!o.store.state.matter) {
        o.store.state.matter = { enabledAt: new Date().toISOString() };
        await o.store.save();
        await o.registry.addAdapter(make(), false);
      }
      try {
        const nodeId = await adapter!.commission(pairingCode);
        const added = await o.registry.discoverAndAdd("matter");
        return { nodeId, devicesAdded: added };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (err instanceof MatterStackError) {
          throw new SetupError(503, "MATTER_UNAVAILABLE", `${msg}. Matter heeft IPv6 en toegang tot het lokale netwerk nodig. Op een Mac: sta "Lokaal netwerk" toe voor Terminal/Node en controleer dat je Mac op hetzelfde netwerk zit als de DIRIGERA.`);
        }
        if (/koppelcode/i.test(msg)) throw new SetupError(400, "INVALID_CODE", msg);
        throw new SetupError(502, "COMMISSION_FAILED", `Koppelen via Matter mislukt: ${msg}. Vraag in de app een nieuwe code aan (een code werkt maar één keer) en zorg dat dit apparaat en de hub op hetzelfde netwerk zitten.`);
      }
    },
    async removeNode(nodeId: string) {
      if (!adapter) throw new SetupError(404, "NOT_FOUND", "Matter is niet actief");
      await adapter.removeNode(nodeId);
      await o.registry.discoverAndAdd("matter");
      return { ok: true };
    },
  };
}

export type MatterService = ReturnType<typeof createMatterService>;

import { discoverBridges, HueAdapter, pairBridge, type DeviceAdapter, type DiscoveredBridge, type PairResult } from "@homeos/integrations";
import type { DeviceRegistry } from "./registry";
import type { SecretStore } from "./secret-store";
import type { IntegrationsStore } from "./integrations-store";

export interface HueDeps {
  discover: () => Promise<DiscoveredBridge[]>;
  pair: (host: string) => Promise<PairResult>;
  makeAdapter: (cfg: { bridgeId: string; host: string; name: string; fingerprint256: string }) => DeviceAdapter;
}

export const realHueDeps: HueDeps = {
  discover: () => discoverBridges(),
  pair: (host) => pairBridge(host),
  makeAdapter: (cfg) => new HueAdapter(cfg),
};

const adapterIdFor = (bridgeId: string) => `hue-${bridgeId.slice(-6)}`;

/** Beheer van Philips Hue-bridges in de connector: zoeken, koppelen, ontkoppelen. */
export function createHueService(o: { registry: DeviceRegistry; secrets: SecretStore; store: IntegrationsStore; deps: HueDeps }) {
  return {
    /** Adapters voor al gekoppelde bridges (bij opstarten). */
    adapters(): DeviceAdapter[] {
      return o.store.state.hue.map((b) => o.deps.makeAdapter(b));
    },

    list() {
      return o.store.state.hue.map((b) => ({
        bridgeId: b.bridgeId,
        host: b.host,
        name: b.name,
        pairedAt: b.pairedAt,
        adapterId: adapterIdFor(b.bridgeId),
        health: o.registry.adapterHealth(adapterIdFor(b.bridgeId)),
      }));
    },

    async discover() {
      let bridges: DiscoveredBridge[] = [];
      let message: string | null = null;
      try {
        bridges = await o.deps.discover();
      } catch {
        message = "De Hue-discoverydienst is niet bereikbaar. Vul het IP-adres van de bridge handmatig in (te vinden in de Hue-app).";
      }
      const paired = new Set(o.store.state.hue.map((b) => b.bridgeId));
      return { bridges: bridges.map((b) => ({ ...b, paired: paired.has(b.id) })), message };
    },

    async pair(host: string): Promise<PairResult> {
      const result = await o.deps.pair(host);
      if (!result.ok) return result;
      const record = {
        bridgeId: result.bridge.bridgeId,
        host,
        name: result.bridge.name.slice(0, 80),
        fingerprint256: result.fingerprint256,
        pairedAt: new Date().toISOString(),
      };
      const scope = o.secrets.scoped(adapterIdFor(record.bridgeId));
      await scope.set("appKey", result.appKey);
      if (result.clientKey) await scope.set("clientKey", result.clientKey);
      o.store.state.hue = [...o.store.state.hue.filter((b) => b.bridgeId !== record.bridgeId), record];
      await o.store.save();
      await o.registry.addAdapter(o.deps.makeAdapter(record), true);
      // De key zelf gaat nooit terug naar de aanroeper.
      return { ...result, appKey: "[opgeslagen]", clientKey: null };
    },

    async unpair(bridgeId: string): Promise<boolean> {
      const rec = o.store.state.hue.find((b) => b.bridgeId === bridgeId);
      if (!rec) return false;
      const id = adapterIdFor(bridgeId);
      await o.registry.removeAdapter(id, true);
      const scope = o.secrets.scoped(id);
      await scope.delete("appKey");
      await scope.delete("clientKey");
      o.store.state.hue = o.store.state.hue.filter((b) => b.bridgeId !== bridgeId);
      await o.store.save();
      return true;
    },
  };
}

export type HueService = ReturnType<typeof createHueService>;

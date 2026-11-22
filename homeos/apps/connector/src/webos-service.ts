import { discoverTvs, pairTv, WebOsAdapter, type DeviceAdapter, type DiscoveredTv, type TvPairResult } from "@homeos/integrations";
import type { DeviceRegistry } from "./registry";
import type { SecretStore } from "./secret-store";
import type { IntegrationsStore, WebOsTvRecord } from "./integrations-store";

export interface WebOsDeps {
  discover: () => Promise<DiscoveredTv[]>;
  pair: (host: string, mac: string | null) => Promise<TvPairResult>;
  makeAdapter: (rec: WebOsTvRecord) => DeviceAdapter;
}

export const realWebOsDeps: WebOsDeps = {
  discover: () => discoverTvs(),
  pair: (host, mac) => pairTv(host, { manualMac: mac }),
  makeAdapter: (rec) => new WebOsAdapter(rec),
};

const adapterIdFor = (tvId: string) => `lgtv-${tvId.slice(-6)}`;

/** Beheer van LG webOS-tv's: zoeken, koppelen (melding op de tv), ontkoppelen. */
export function createWebOsService(o: { registry: DeviceRegistry; secrets: SecretStore; store: IntegrationsStore; deps: WebOsDeps }) {
  let pairing = false;
  return {
    adapters(): DeviceAdapter[] {
      return o.store.state.webos.map((t) => o.deps.makeAdapter(t));
    },

    list() {
      return o.store.state.webos.map((t) => ({
        tvId: t.tvId,
        host: t.host,
        name: t.name,
        model: t.model,
        encrypted: t.scheme === "wss",
        wakeOnLan: !!t.mac,
        pairedAt: t.pairedAt,
        adapterId: adapterIdFor(t.tvId),
        health: o.registry.adapterHealth(adapterIdFor(t.tvId)),
      }));
    },

    async discover() {
      const paired = new Set(o.store.state.webos.map((t) => t.host));
      try {
        const tvs = await o.deps.discover();
        return { tvs: tvs.map((t) => ({ ...t, paired: paired.has(t.host) })), message: tvs.length ? null : "Geen tv gevonden. Staat hij aan? Vul anders het IP-adres in (Instellingen → Netwerk op de tv)." };
      } catch {
        return { tvs: [], message: "Zoeken lukte niet. Vul het IP-adres van de tv handmatig in." };
      }
    },

    async pair(host: string, mac: string | null): Promise<TvPairResult> {
      if (pairing) return { ok: false, code: "BUSY", message: "Er loopt al een koppeling. Bevestig eerst de melding op de tv." };
      pairing = true;
      try {
        const r = await o.deps.pair(host, mac);
        if (!r.ok) return r;
        const rec: WebOsTvRecord = { ...r.tv, pairedAt: new Date().toISOString() };
        const id = adapterIdFor(rec.tvId);
        await o.secrets.scoped(id).set("clientKey", r.clientKey);
        o.store.state.webos = [...o.store.state.webos.filter((t) => t.tvId !== rec.tvId), rec];
        await o.store.save();
        await o.registry.addAdapter(o.deps.makeAdapter(rec), true);
        // De client-key zelf gaat nooit terug naar de aanroeper.
        return { ...r, clientKey: "[opgeslagen]" };
      } finally {
        pairing = false;
      }
    },

    async unpair(tvId: string): Promise<boolean> {
      const rec = o.store.state.webos.find((t) => t.tvId === tvId);
      if (!rec) return false;
      const id = adapterIdFor(tvId);
      await o.registry.removeAdapter(id, true);
      await o.secrets.scoped(id).delete("clientKey");
      o.store.state.webos = o.store.state.webos.filter((t) => t.tvId !== tvId);
      await o.store.save();
      return true;
    },
  };
}

export type WebOsService = ReturnType<typeof createWebOsService>;

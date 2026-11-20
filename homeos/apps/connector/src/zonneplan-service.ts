import { ZonneplanAdapter, ZonneplanApi, ZonneplanError, type DeviceAdapter } from "@homeos/integrations";
import type { DeviceRegistry } from "./registry";
import type { SecretStore } from "./secret-store";
import type { IntegrationsStore } from "./integrations-store";
import { SetupError } from "./cloud-service";

const adapterIdFor = (connectionUuid: string) => `zonneplan-${connectionUuid.replace(/-/g, "").slice(-6)}`;
const PENDING_MS = 15 * 60_000;

/**
 * Zonneplan Connect (NIET-OFFICIEEL, op verzoek van de gebruiker). Inloggen met de code die Zonneplan mailt.
 * Het e-mailadres wordt niet bewaard; de tokens alleen versleuteld in de SecretStore.
 */
export function createZonneplanService(o: { registry: DeviceRegistry; secrets: SecretStore; store: IntegrationsStore; fetchImpl?: typeof fetch }) {
  const api = new ZonneplanApi(o.fetchImpl ?? fetch);
  let pending: { authSession: string; verifier: string; until: number } | null = null;
  const make = (rec: { connectionUuid: string; label: string }) => new ZonneplanAdapter(rec, api);
  const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof SetupError) throw e;
      const err = e as ZonneplanError;
      const status = err.code === "UNAUTHORIZED" ? 401 : err.code === "INVALID" ? 400 : err.code === "RATE_LIMITED" ? 429 : 502;
      throw new SetupError(status, err.code ?? "ZONNEPLAN", err.message);
    }
  };

  return {
    adapters(): DeviceAdapter[] {
      return o.store.state.zonneplan ? [make(o.store.state.zonneplan)] : [];
    },

    list() {
      const z = o.store.state.zonneplan;
      return z ? { connected: true, label: z.label, addedAt: z.addedAt, unofficial: true, health: o.registry.adapterHealth(adapterIdFor(z.connectionUuid)) } : { connected: false, unofficial: true, pending: !!pending && pending.until > Date.now() };
    },

    async start(email: string) {
      return wrap(async () => {
        const r = await api.requestCode(email);
        pending = { ...r, until: Date.now() + PENDING_MS };
        return { ok: true, message: "Zonneplan heeft een code naar je e-mail gestuurd." };
      });
    },

    async complete(code: string) {
      return wrap(async () => {
        if (!pending || pending.until < Date.now()) throw new SetupError(409, "NO_PENDING", "Vraag eerst een nieuwe code aan.");
        const tokens = await api.submitCode(pending.authSession, code, pending.verifier);
        pending = null;
        const conns = await api.connections(tokens.accessToken);
        const c = conns.find((x) => x.p1);
        if (!c?.p1) throw new SetupError(404, "NO_P1", "Ingelogd, maar er is geen Zonneplan Connect gevonden bij je account.");
        const rec = { connectionUuid: c.connectionUuid, label: c.p1.label || "Zonneplan Connect", addedAt: new Date().toISOString() };
        if (o.store.state.zonneplan) await o.registry.removeAdapter(adapterIdFor(o.store.state.zonneplan.connectionUuid), false);
        await o.secrets.scoped(adapterIdFor(rec.connectionUuid)).set("tokens", JSON.stringify(tokens));
        o.store.state.zonneplan = rec;
        await o.store.save();
        await o.registry.addAdapter(make(rec), true);
        return { ok: true, label: rec.label };
      });
    },

    async remove() {
      const z = o.store.state.zonneplan;
      if (!z) throw new SetupError(404, "NOT_FOUND", "Zonneplan is niet gekoppeld");
      const id = adapterIdFor(z.connectionUuid);
      await o.registry.removeAdapter(id, true);
      await o.secrets.scoped(id).delete("tokens");
      o.store.state.zonneplan = null;
      await o.store.save();
      return { ok: true };
    },
  };
}

export type ZonneplanService = ReturnType<typeof createZonneplanService>;

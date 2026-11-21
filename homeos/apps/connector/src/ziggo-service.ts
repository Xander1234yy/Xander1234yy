import { ZiggoAdapter, ZiggoApi, ZiggoError, type DeviceAdapter, type MqttConnect } from "@homeos/integrations";
import type { DeviceRegistry } from "./registry";
import type { SecretStore } from "./secret-store";
import type { IntegrationsStore } from "./integrations-store";
import { SetupError } from "./cloud-service";

const ADAPTER_ID = "ziggo";
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

/**
 * Ziggo Mediabox — NIET-OFFICIËLE koppeling op uitdrukkelijk verzoek van de gebruiker. Inloggegevens versleuteld
 * (nodig om opnieuw aan te melden als Ziggo de sessie beëindigt); alleen box-ID's en namen in de gewone opslag.
 */
export function createZiggoService(o: { registry: DeviceRegistry; secrets: SecretStore; store: IntegrationsStore; fetchImpl?: typeof fetch; mqttConnect?: MqttConnect }) {
  const scope = o.secrets.scoped(ADAPTER_ID);
  const make = () => new ZiggoAdapter({ boxes: o.store.state.ziggo!.boxes, cityId: o.store.state.ziggo!.cityId }, o.fetchImpl, o.mqttConnect);
  return {
    adapters(): DeviceAdapter[] {
      return o.store.state.ziggo ? [make()] : [];
    },
    list() {
      const z = o.store.state.ziggo;
      return z ? { connected: true, unofficial: true, addedAt: z.addedAt, boxes: z.boxes.map((b) => b.name), health: o.registry.adapterHealth(ADAPTER_ID) } : { connected: false, unofficial: true };
    },
    async connect(username: string, password: string) {
      const user = username.trim();
      if (!EMAIL.test(user)) throw new SetupError(400, "INVALID", "Vul het e-mailadres van je Ziggo-account in");
      if (password.length < 4 || password.length > 200) throw new SetupError(400, "INVALID", "Vul je Ziggo-wachtwoord in");
      const api = new ZiggoApi(o.fetchImpl);
      let session, found;
      try {
        const s = await api.services();
        session = await api.login(s, user, password);
        found = await api.boxes(s, session);
      } catch (e) {
        const err = e as ZiggoError;
        throw new SetupError(err.code === "UNAUTHORIZED" ? 401 : err.code === "UNAVAILABLE" ? 503 : 502, "ZIGGO", err.message);
      }
      if (found.boxes.length === 0) throw new SetupError(404, "NO_BOXES", "Geen Ziggo-mediabox gevonden in dit account");
      await scope.set("credentials", JSON.stringify({ username: user, password }));
      await scope.set("session", JSON.stringify(session));
      o.store.state.ziggo = { addedAt: new Date().toISOString(), cityId: found.cityId, boxes: found.boxes.slice(0, 5) };
      await o.store.save();
      await o.registry.removeAdapter(ADAPTER_ID, true).catch(() => undefined);
      await o.registry.addAdapter(make(), true);
      return { ok: true, boxes: o.store.state.ziggo.boxes.map((b) => b.name) };
    },
    async remove() {
      if (!o.store.state.ziggo) throw new SetupError(404, "NOT_FOUND", "Ziggo is niet gekoppeld");
      await o.registry.removeAdapter(ADAPTER_ID, true);
      await scope.delete("credentials");
      await scope.delete("session");
      o.store.state.ziggo = null;
      await o.store.save();
      return { ok: true };
    },
  };
}

export type ZiggoService = ReturnType<typeof createZiggoService>;

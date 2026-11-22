import { randomBytes } from "node:crypto";
import { HueAdapter, createHueRemoteHttp, createRemoteAppKey, exchangeHueCode, hueAuthorizeUrl, HueRemoteError, type DeviceAdapter } from "@homeos/integrations";
import type { DeviceRegistry } from "./registry";
import type { SecretStore } from "./secret-store";
import type { IntegrationsStore } from "./integrations-store";
import { SetupError } from "./cloud-service";

const ADAPTER_ID = "huecloud";
const PENDING_MS = 15 * 60_000;

/** Philips Hue via de officiële Hue Remote API (cloud). Werkt zonder apparaat thuis; tokens versleuteld bewaard. */
export function createHueCloudService(o: { registry: DeviceRegistry; secrets: SecretStore; store: IntegrationsStore; fetchImpl?: typeof fetch }) {
  const f = o.fetchImpl ?? fetch;
  const scope = o.secrets.scoped(ADAPTER_ID);
  const pending = o.secrets.scoped("pending");
  const make = (clientId: string) =>
    new HueAdapter(
      { bridgeId: "cloud00000000000", host: "api.meethue.com", name: "Hue-cloud", fingerprint256: "" },
      (appKey, ctx) => createHueRemoteHttp({ appKey, ctx, clientId, fetchImpl: f }),
      { id: ADAPTER_ID, displayName: "Philips Hue (Hue-cloud)" },
    );
  const wrap = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof SetupError) throw e;
      const err = e as HueRemoteError;
      throw new SetupError(err.code === "UNAUTHORIZED" ? 401 : err.code === "RATE_LIMITED" ? 429 : 502, err.code ?? "HUE_CLOUD", err.message);
    }
  };

  return {
    adapters(): DeviceAdapter[] {
      return o.store.state.huecloud ? [make(o.store.state.huecloud.clientId)] : [];
    },
    list() {
      const h = o.store.state.huecloud;
      return h ? { connected: true, addedAt: h.addedAt, health: o.registry.adapterHealth(ADAPTER_ID) } : { connected: false };
    },
    async start(clientId: string, clientSecret: string) {
      if (!/^[\w-]{2,100}$/.test(clientId) || clientSecret.length < 4 || clientSecret.length > 200) throw new SetupError(400, "INVALID", "Vul de client-ID en client secret van je Hue-app in");
      const state = randomBytes(24).toString("base64url");
      await pending.set("huecloud", JSON.stringify({ state, clientId, clientSecret, until: Date.now() + PENDING_MS }));
      return { authorizeUrl: hueAuthorizeUrl(clientId, state) };
    },
    async complete(code: string, state: string) {
      return wrap(async () => {
        const raw = await pending.get("huecloud");
        const p = raw ? (JSON.parse(raw) as { state: string; clientId: string; clientSecret: string; until: number }) : null;
        if (!p || p.until < Date.now()) throw new SetupError(409, "NO_PENDING", "Start het koppelen opnieuw (de vorige poging is verlopen)");
        if (p.state !== state) throw new SetupError(400, "STATE_MISMATCH", "Deze terugkoppeling hoort niet bij deze koppelpoging");
        const tokens = await exchangeHueCode(f, p.clientId, p.clientSecret, code);
        const appKey = await createRemoteAppKey(f, tokens.accessToken);
        await scope.set("clientSecret", p.clientSecret);
        await scope.set("tokens", JSON.stringify(tokens));
        await scope.set("appKey", appKey);
        await pending.delete("huecloud");
        o.store.state.huecloud = { clientId: p.clientId, addedAt: new Date().toISOString() };
        await o.store.save();
        await o.registry.addAdapter(make(p.clientId), true);
        return { ok: true };
      });
    },
    async remove() {
      if (!o.store.state.huecloud) throw new SetupError(404, "NOT_FOUND", "Hue-cloud is niet gekoppeld");
      await o.registry.removeAdapter(ADAPTER_ID, true);
      for (const k of ["clientSecret", "tokens", "appKey"]) await scope.delete(k);
      o.store.state.huecloud = null;
      await o.store.save();
      return { ok: true };
    },
  };
}

export type HueCloudService = ReturnType<typeof createHueCloudService>;

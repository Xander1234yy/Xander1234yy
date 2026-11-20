import { randomBytes } from "node:crypto";
import {
  authorizeUrl,
  CloudApiError,
  DaikinAdapter,
  parseCallbackUrl,
  SolarEdgeAdapter,
  tokenRequest,
  TuyaAdapter,
  validateTuya,
  type TuyaRegion,
  validateRedirectUri,
  validateSolarEdge,
} from "@homeos/integrations";
import type { DeviceRegistry } from "./registry";
import type { SecretStore } from "./secret-store";
import type { IntegrationsStore } from "./integrations-store";

export class SetupError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Cloud-integraties met officiële API's: SolarEdge (API-key) en Daikin Onecta (OAuth2).
 * Geheimen gaan alleen naar de versleutelde SecretStore; antwoorden bevatten nooit keys of tokens.
 */
export function createCloudIntegrations(o: { registry: DeviceRegistry; secrets: SecretStore; store: IntegrationsStore; fetchImpl?: typeof fetch }) {
  const f = o.fetchImpl ?? fetch;
  const se = (siteId: string) => `solaredge-${siteId}`;
  let pendingDaikin: { state: string; clientId: string; clientSecret: string; redirectUri: string; expires: number } | null = null;

  const toSetup = (err: unknown): never => {
    if (err instanceof SetupError) throw err;
    if (err instanceof CloudApiError) throw new SetupError(err.kind === "auth" || err.kind === "invalid" ? 400 : 502, err.kind.toUpperCase(), err.message);
    throw new SetupError(502, "FAILED", "Koppelen mislukt");
  };

  return {
    adapters() {
      return [
        ...o.store.state.solaredge.map((s) => new SolarEdgeAdapter(s, f)),
        ...(o.store.state.daikin ? [new DaikinAdapter(o.store.state.daikin, f)] : []),
        ...(o.store.state.tuya ? [new TuyaAdapter(o.store.state.tuya, f)] : []),
      ];
    },

    list() {
      return {
        solaredge: o.store.state.solaredge.map((s) => ({ ...s, health: o.registry.adapterHealth(se(s.siteId)) })),
        daikin: o.store.state.daikin
          ? { clientId: o.store.state.daikin.clientId, redirectUri: o.store.state.daikin.redirectUri, connectedAt: o.store.state.daikin.connectedAt, health: o.registry.adapterHealth("daikin-onecta") }
          : null,
        tuya: o.store.state.tuya ? { region: o.store.state.tuya.region, uid: o.store.state.tuya.uid, addedAt: o.store.state.tuya.addedAt, health: o.registry.adapterHealth("tuya") } : null,
      };
    },

    // ───────────── Smart Life / Tuya ─────────────
    async addTuya(region: TuyaRegion, accessId: string, accessSecret: string, uid: string) {
      try {
        const cfg = { region, accessId: accessId.trim(), uid: uid.trim() };
        const count = await validateTuya(cfg, accessSecret.trim(), f);
        await o.secrets.scoped("tuya").set("accessSecret", accessSecret.trim());
        o.store.state.tuya = { ...cfg, addedAt: new Date().toISOString() };
        await o.store.save();
        await o.registry.addAdapter(new TuyaAdapter(cfg, f), true);
        return { devicesFound: count };
      } catch (err) {
        return toSetup(err);
      }
    },

    async removeTuya() {
      if (!o.store.state.tuya) throw new SetupError(404, "NOT_FOUND", "Tuya is niet gekoppeld");
      await o.registry.removeAdapter("tuya", true);
      await o.secrets.scoped("tuya").delete("accessSecret");
      o.store.state.tuya = null;
      await o.store.save();
      return { ok: true };
    },

    // ───────────── SolarEdge ─────────────
    async addSolarEdge(siteId: string, apiKey: string) {
      try {
        const cfg = await validateSolarEdge(siteId.trim(), apiKey.trim(), f);
        await o.secrets.scoped(se(cfg.siteId)).set("apiKey", apiKey.trim());
        const record = { ...cfg, addedAt: new Date().toISOString() };
        o.store.state.solaredge = [...o.store.state.solaredge.filter((s) => s.siteId !== cfg.siteId), record];
        await o.store.save();
        await o.registry.addAdapter(new SolarEdgeAdapter(cfg, f), true);
        return { site: { siteId: cfg.siteId, name: cfg.name, peakPowerKw: cfg.peakPowerKw } };
      } catch (err) {
        return toSetup(err);
      }
    },

    async removeSolarEdge(siteId: string) {
      if (!o.store.state.solaredge.some((s) => s.siteId === siteId)) throw new SetupError(404, "NOT_FOUND", "Installatie niet gevonden");
      await o.registry.removeAdapter(se(siteId), true);
      await o.secrets.scoped(se(siteId)).delete("apiKey");
      o.store.state.solaredge = o.store.state.solaredge.filter((s) => s.siteId !== siteId);
      await o.store.save();
      return { ok: true };
    },

    // ───────────── Daikin Onecta ─────────────
    startDaikin(clientId: string, clientSecret: string, redirectUri: string) {
      const problem = validateRedirectUri(redirectUri);
      if (problem) throw new SetupError(400, "INVALID_REDIRECT", problem);
      if (!clientId.trim() || !clientSecret.trim()) throw new SetupError(400, "INVALID", "Vul client-ID en client secret in");
      const state = randomBytes(24).toString("base64url");
      pendingDaikin = { state, clientId: clientId.trim(), clientSecret: clientSecret.trim(), redirectUri, expires: Date.now() + 15 * 60_000 };
      return { authorizeUrl: authorizeUrl({ clientId: pendingDaikin.clientId, redirectUri, state }), expiresInMinutes: 15 };
    },

    async completeDaikin(callbackUrl: string) {
      const p = pendingDaikin;
      if (!p || p.expires < Date.now()) throw new SetupError(409, "NO_PENDING", "Start het koppelen opnieuw (de vorige poging is verlopen)");
      const parsed = parseCallbackUrl(callbackUrl);
      if ("error" in parsed) throw new SetupError(400, "INVALID_CALLBACK", parsed.error);
      // Bescherming tegen CSRF/verwisseling: de state moet exact overeenkomen.
      if (parsed.state !== p.state) throw new SetupError(400, "STATE_MISMATCH", "Deze link hoort niet bij deze koppelpoging. Start opnieuw.");
      if (!callbackUrl.startsWith(p.redirectUri.split("?")[0]!)) throw new SetupError(400, "WRONG_REDIRECT", "De URL komt niet overeen met de ingestelde redirect-URI");
      try {
        const tokens = await tokenRequest(f, {
          grant_type: "authorization_code",
          code: parsed.code,
          redirect_uri: p.redirectUri,
          client_id: p.clientId,
          client_secret: p.clientSecret,
        });
        pendingDaikin = null;
        const scope = o.secrets.scoped("daikin-onecta");
        await scope.set("clientSecret", p.clientSecret);
        await scope.set("tokens", JSON.stringify(tokens));
        o.store.state.daikin = { clientId: p.clientId, redirectUri: p.redirectUri, connectedAt: new Date().toISOString() };
        await o.store.save();
        await o.registry.addAdapter(new DaikinAdapter(o.store.state.daikin, f), true);
        return { ok: true };
      } catch (err) {
        return toSetup(err);
      }
    },

    async removeDaikin() {
      if (!o.store.state.daikin) throw new SetupError(404, "NOT_FOUND", "Daikin is niet gekoppeld");
      await o.registry.removeAdapter("daikin-onecta", true);
      const scope = o.secrets.scoped("daikin-onecta");
      await scope.delete("clientSecret");
      await scope.delete("tokens");
      o.store.state.daikin = null;
      await o.store.save();
      return { ok: true };
    },
  };
}

export type CloudIntegrations = ReturnType<typeof createCloudIntegrations>;

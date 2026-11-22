import { createHash, randomBytes } from "node:crypto";
import { GoogleHomeAdapter, GoogleAssistantError, exchangeGoogleCode, googleAuthorizeUrl, type AssistantTransport, type DeviceAdapter } from "@homeos/integrations";
import type { DeviceRegistry } from "./registry";
import type { SecretStore } from "./secret-store";
import type { IntegrationsStore } from "./integrations-store";
import { SetupError } from "./cloud-service";

const ADAPTER_ID = "googlehome";
const PENDING_MS = 15 * 60_000;
const CALLBACK_PATH = "/api/integrations/googlehome/callback";
export const GOOGLE_DEVICE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} '&.-]{0,59}$/u;

export function deviceIdFor(name: string): string {
  return createHash("sha256").update(name.trim().toLowerCase()).digest("hex").slice(0, 16);
}

/** Alleen https (of http op localhost) en exact het eigen callback-pad. */
export function validRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    const local = u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname);
    return (u.protocol === "https:" || local) && u.pathname === CALLBACK_PATH && !u.search && !u.hash && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Google Home-apparaten via de officiële Google Assistant SDK (alleen tekstopdrachten, status niet terug te lezen). */
export function createGoogleHomeService(o: { registry: DeviceRegistry; secrets: SecretStore; store: IntegrationsStore; fetchImpl?: typeof fetch; transport?: AssistantTransport }) {
  const f = o.fetchImpl ?? fetch;
  const scope = o.secrets.scoped(ADAPTER_ID);
  const pending = o.secrets.scoped("pending");
  const make = () => {
    const g = o.store.state.googlehome!;
    return new GoogleHomeAdapter({ clientId: g.clientId, languageCode: g.languageCode, devices: g.devices }, f, o.transport);
  };
  const reload = async () => {
    await o.registry.removeAdapter(ADAPTER_ID, true).catch(() => undefined);
    await o.registry.addAdapter(make(), true);
  };
  const names = (list: string[]) => {
    const clean = [...new Set(list.map((n) => n.trim().replace(/\s+/g, " ")).filter(Boolean))];
    if (clean.length > 30) throw new SetupError(400, "INVALID", "Maximaal 30 apparaten");
    const bad = clean.find((n) => !GOOGLE_DEVICE_NAME.test(n));
    if (bad) throw new SetupError(400, "INVALID", `Ongeldige naam: "${bad.slice(0, 60)}" (letters, cijfers, spaties, max. 60 tekens)`);
    return clean.map((name) => ({ id: deviceIdFor(name), name }));
  };

  return {
    adapters(): DeviceAdapter[] {
      return o.store.state.googlehome ? [make()] : [];
    },
    list() {
      const g = o.store.state.googlehome;
      return g ? { connected: true, addedAt: g.addedAt, devices: g.devices.map((d) => d.name), health: o.registry.adapterHealth(ADAPTER_ID) } : { connected: false };
    },
    async start(clientId: string, clientSecret: string, redirectUri: string) {
      if (!/^[\w.-]{10,200}\.apps\.googleusercontent\.com$/.test(clientId)) throw new SetupError(400, "INVALID", "De client-ID eindigt op .apps.googleusercontent.com");
      if (clientSecret.length < 8 || clientSecret.length > 200 || /\s/.test(clientSecret)) throw new SetupError(400, "INVALID", "Vul het client secret van je Google-app in");
      if (!validRedirectUri(redirectUri)) throw new SetupError(400, "INVALID", "Ongeldige terugkoppel-URL");
      const state = randomBytes(24).toString("base64url");
      await pending.set("googlehome", JSON.stringify({ state, clientId, clientSecret, redirectUri, until: Date.now() + PENDING_MS }));
      return { authorizeUrl: googleAuthorizeUrl(clientId, redirectUri, state) };
    },
    async complete(code: string, state: string) {
      const raw = await pending.get("googlehome");
      const p = raw ? (JSON.parse(raw) as { state: string; clientId: string; clientSecret: string; redirectUri: string; until: number }) : null;
      if (!p || p.until < Date.now()) throw new SetupError(409, "NO_PENDING", "Start het koppelen opnieuw (de vorige poging is verlopen)");
      if (p.state !== state) throw new SetupError(400, "STATE_MISMATCH", "Deze terugkoppeling hoort niet bij deze koppelpoging");
      let tokens;
      try {
        tokens = await exchangeGoogleCode(f, p.clientId, p.clientSecret, code, p.redirectUri);
      } catch (e) {
        const err = e as GoogleAssistantError;
        throw new SetupError(err.code === "UNAUTHORIZED" ? 401 : 502, "GOOGLE", err.message);
      }
      await scope.set("clientSecret", p.clientSecret);
      await scope.set("tokens", JSON.stringify(tokens));
      await pending.delete("googlehome");
      o.store.state.googlehome = { clientId: p.clientId, languageCode: o.store.state.googlehome?.languageCode ?? "nl-NL", devices: o.store.state.googlehome?.devices ?? [], addedAt: new Date().toISOString() };
      await o.store.save();
      await reload();
      return { ok: true };
    },
    async setDevices(list: string[]) {
      if (!o.store.state.googlehome) throw new SetupError(404, "NOT_FOUND", "Google Home is niet gekoppeld");
      o.store.state.googlehome.devices = names(list);
      await o.store.save();
      await reload();
      return { ok: true, devices: o.store.state.googlehome.devices.map((d) => d.name) };
    },
    async remove() {
      if (!o.store.state.googlehome) throw new SetupError(404, "NOT_FOUND", "Google Home is niet gekoppeld");
      await o.registry.removeAdapter(ADAPTER_ID, true);
      for (const k of ["clientSecret", "tokens"]) await scope.delete(k);
      o.store.state.googlehome = null;
      await o.store.save();
      return { ok: true };
    },
  };
}

export type GoogleHomeService = ReturnType<typeof createGoogleHomeService>;

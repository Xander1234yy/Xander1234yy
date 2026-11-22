import { randomUUID } from "node:crypto";
import { TapoCloudAdapter, TapoCloudClient, TapoCloudError, type DeviceAdapter, type RelaySocket, type TapoHttp } from "@homeos/integrations";
import type { DeviceRegistry } from "./registry";
import type { SecretStore } from "./secret-store";
import type { IntegrationsStore } from "./integrations-store";
import { SetupError } from "./cloud-service";

const ADAPTER_ID = "tapocloud";
const PENDING_MS = 10 * 60_000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

/**
 * Tapo-camera's via de TP-Link-cloud — NIET-OFFICIËLE koppeling op uitdrukkelijk verzoek. Inloggegevens versleuteld
 * (om zonder verificatiecode opnieuw aan te melden); een vaste terminal-ID per huishouden zodat TP-Link HomeOS na de
 * verificatiecode herkent. Verificatiecode-pogingen versleuteld in "pending", nooit in het geheugen (serverless).
 */
export function createTapoCloudService(o: { registry: DeviceRegistry; secrets: SecretStore; store: IntegrationsStore; http?: TapoHttp; relaySocket?: RelaySocket }) {
  const scope = o.secrets.scoped(ADAPTER_ID);
  const pending = o.secrets.scoped("pending");
  const make = () => new TapoCloudAdapter({ cameras: o.store.state.tapocloud!.cameras }, o.http);
  const terminal = async () => {
    let t = await scope.get("terminalUUID");
    if (!t) {
      t = randomUUID();
      await scope.set("terminalUUID", t);
    }
    return t;
  };
  const fail = (e: unknown): never => {
    if (e instanceof SetupError) throw e;
    const err = e as TapoCloudError;
    throw new SetupError(err.code === "UNAUTHORIZED" ? 401 : err.code === "UNAVAILABLE" ? 503 : 502, "TAPO", err.message ?? "TP-Link-fout");
  };
  const finish = async (client: TapoCloudClient, email: string, password: string, s: { base: string; token: string; refreshToken: string | null }) => {
    const cameras = await client.cameras(s.base, s.token);
    if (cameras.length === 0) throw new SetupError(404, "NO_CAMERAS", "Geen Tapo-camera's of -deurbel gevonden in dit account");
    await scope.set("credentials", JSON.stringify({ email, password }));
    await scope.set("session", JSON.stringify(s));
    o.store.state.tapocloud = { addedAt: new Date().toISOString(), cameras: cameras.slice(0, 20) };
    await o.store.save();
    await o.registry.removeAdapter(ADAPTER_ID, true).catch(() => undefined);
    await o.registry.addAdapter(make(), true);
    return { ok: true, cameras: o.store.state.tapocloud.cameras.map((c) => c.name) };
  };

  return {
    adapters(): DeviceAdapter[] {
      return o.store.state.tapocloud ? [make()] : [];
    },
    list() {
      const t = o.store.state.tapocloud;
      return t ? { connected: true, unofficial: true, addedAt: t.addedAt, cameras: t.cameras.map((c) => c.name), health: o.registry.adapterHealth(ADAPTER_ID) } : { connected: false, unofficial: true };
    },
    async connect(email: string, password: string) {
      const user = email.trim().toLowerCase();
      if (!EMAIL.test(user)) throw new SetupError(400, "INVALID", "Vul het e-mailadres van je Tapo-account in");
      if (password.length < 4 || password.length > 200) throw new SetupError(400, "INVALID", "Vul je Tapo-wachtwoord in");
      try {
        const client = new TapoCloudClient(await terminal(), o.http);
        const r = await client.login(user, password);
        if (r.kind === "mfa") {
          await pending.set("tapocloud", JSON.stringify({ email: user, password, base: r.base, processId: r.processId, mfaType: r.mfaType, until: Date.now() + PENDING_MS }));
          return { ok: false, mfa: true, via: r.mfaType === 1 ? "app" : "email" };
        }
        return await finish(client, user, password, r);
      } catch (e) {
        return fail(e);
      }
    },
    async verify(code: string) {
      if (!/^\d{4,8}$/.test(code.trim())) throw new SetupError(400, "INVALID", "Vul de verificatiecode in (alleen cijfers)");
      const raw = await pending.get("tapocloud");
      const p = raw ? (JSON.parse(raw) as { email: string; password: string; base: string; processId: string; mfaType: 1 | 2; until: number }) : null;
      if (!p || p.until < Date.now()) throw new SetupError(409, "NO_PENDING", "Begin opnieuw met koppelen (de vorige poging is verlopen)");
      try {
        const client = new TapoCloudClient(await terminal(), o.http);
        const s = await client.completeMfa(p.base, p.email, p.processId, p.mfaType, code.trim());
        await pending.delete("tapocloud");
        return await finish(client, p.email, p.password, s);
      } catch (e) {
        return fail(e);
      }
    },
    /** Live beeld (MPEG-TS) van een camera via het TP-Link-relais; geeft de stroom terug of gooit een duidelijke fout. */
    async live(deviceId: string, signal?: AbortSignal) {
      const t = o.store.state.tapocloud;
      if (!t || !t.cameras.some((c) => c.deviceId === deviceId)) throw new SetupError(404, "NOT_FOUND", "Camera niet gevonden");
      const a = new TapoCloudAdapter({ cameras: t.cameras }, o.http, Date.now, o.relaySocket);
      await a.prepare(scope);
      try {
        return await a.openLive(deviceId, { ...(signal ? { signal } : {}), maxMs: 240_000 });
      } catch (e) {
        const err = e as TapoCloudError;
        throw new SetupError(err.code === "UNAUTHORIZED" || err.code === "EXPIRED" ? 401 : err.code === "UNAVAILABLE" ? 503 : 502, "TAPO_LIVE", err.message);
      }
    },
    async remove() {
      if (!o.store.state.tapocloud) throw new SetupError(404, "NOT_FOUND", "TP-Link-cloud is niet gekoppeld");
      await o.registry.removeAdapter(ADAPTER_ID, true);
      for (const k of ["credentials", "session"]) await scope.delete(k);
      await pending.delete("tapocloud");
      o.store.state.tapocloud = null;
      await o.store.save();
      return { ok: true };
    },
  };
}

export type TapoCloudService = ReturnType<typeof createTapoCloudService>;

import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { MjpegStream, OnvifClient, OnvifError, TapoCameraAdapter, isPrivateLanHost, type DeviceAdapter, type FfmpegInput } from "@homeos/integrations";
import type { DeviceRegistry } from "./registry";
import type { SecretStore } from "./secret-store";
import type { IntegrationsStore, TapoCameraRecord } from "./integrations-store";
import { SetupError } from "./cloud-service";

export interface CameraDeps {
  fetchImpl?: typeof fetch;
  ffmpegPath?: string;
  /** Alleen voor tests: vervangt de RTSP-invoer (bijv. een ffmpeg-testbeeld). */
  inputFor?: (adapter: TapoCameraAdapter) => FfmpegInput;
  hostCheck?: (host: string) => boolean;
}

/** ffmpeg zoeken: eigen instelling, Homebrew (Apple silicon en Intel), systeem, dan PATH. */
export function resolveFfmpeg(explicit = process.env.HOMEOS_FFMPEG_PATH): string {
  if (explicit) return explicit;
  for (const p of ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]) if (existsSync(p)) return p;
  return "ffmpeg";
}

const adapterIdFor = (cameraId: string) => `tapo-${cameraId.slice(-6)}`;

/** Tapo-camera's (ONVIF/RTSP): toevoegen met camera-account, beeld via ffmpeg, verwijderen. */
export function createCameraService(o: { registry: DeviceRegistry; secrets: SecretStore; store: IntegrationsStore; deps?: CameraDeps }) {
  const deps = o.deps ?? {};
  const ffmpegPath = deps.ffmpegPath ?? resolveFfmpeg();
  const adapters = new Map<string, TapoCameraAdapter>();
  const streams = new Map<string, MjpegStream>();

  const make = (rec: TapoCameraRecord) => {
    const a = new TapoCameraAdapter(rec, deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {});
    adapters.set(a.id, a);
    return a;
  };

  /** Device-id (adapter:camera) → adapter. Alleen camera's die bij deze service horen. */
  const byDevice = (deviceId: string) => {
    const adapterId = deviceId.split(":")[0] ?? "";
    const a = adapters.get(adapterId);
    if (!a || deviceId !== `${adapterId}:camera`) throw new SetupError(404, "NOT_FOUND", "Camera niet gevonden");
    if (!o.registry.getDevice(deviceId)) throw new SetupError(404, "NOT_FOUND", "Camera is niet toegevoegd");
    return a;
  };

  const streamFor = (a: TapoCameraAdapter) => {
    let s = streams.get(a.id);
    if (!s) {
      s = new MjpegStream({
        ffmpegPath,
        input: async () => {
          if (deps.inputFor) return deps.inputFor(a);
          const url = a.rtspUrl("low");
          if (!url) throw new Error("Geen camera-account opgeslagen");
          return { args: ["-rtsp_transport", "tcp", "-timeout", "10000000", "-i", url] };
        },
      });
      streams.set(a.id, s);
    }
    return s;
  };

  return {
    adapters(): DeviceAdapter[] {
      return o.store.state.tapo.map(make);
    },

    list() {
      return {
        ffmpeg: ffmpegPath,
        cameras: o.store.state.tapo.map((c) => {
          const id = adapterIdFor(c.cameraId);
          return { cameraId: c.cameraId, host: c.host, name: c.name, model: c.model, addedAt: c.addedAt, deviceId: `${id}:camera`, health: o.registry.adapterHealth(id), streaming: streams.get(id)?.running ?? false };
        }),
      };
    },

    async add(input: { host: string; username: string; password: string; name?: string }) {
      if (!(deps.hostCheck ?? isPrivateLanHost)(input.host)) throw new SetupError(400, "INVALID_HOST", "Gebruik het lokale IP-adres van de camera (bijv. 192.168.68.40).");
      const client = new OnvifClient({ host: input.host, username: input.username, password: input.password, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) });
      let info;
      try {
        await client.syncTime();
        info = await client.deviceInformation();
      } catch (e) {
        const err = e as OnvifError;
        if (err.code === "UNAUTHORIZED") throw new SetupError(401, "UNAUTHORIZED", err.message);
        throw new SetupError(502, "UNREACHABLE", "Camera niet bereikbaar via ONVIF (poort 2020). Staat hij op netstroom en heb je in de Tapo-app een camera-account aangemaakt?");
      }
      const cameraId = createHash("sha256").update(info.serial || input.host).digest("hex").slice(0, 16);
      const rec: TapoCameraRecord = {
        cameraId,
        host: input.host,
        name: (input.name?.trim() || `Tapo ${info.model || "camera"}`).slice(0, 80),
        model: info.model || "Tapo",
        addedAt: new Date().toISOString(),
      };
      const scope = o.secrets.scoped(adapterIdFor(cameraId));
      await scope.set("username", input.username);
      await scope.set("password", input.password);
      o.store.state.tapo = [...o.store.state.tapo.filter((c) => c.cameraId !== cameraId), rec];
      await o.store.save();
      await o.registry.addAdapter(make(rec), true);
      return { camera: rec };
    },

    async remove(cameraId: string) {
      const rec = o.store.state.tapo.find((c) => c.cameraId === cameraId);
      if (!rec) throw new SetupError(404, "NOT_FOUND", "Camera niet gevonden");
      const id = adapterIdFor(cameraId);
      streams.get(id)?.stop();
      streams.delete(id);
      await o.registry.removeAdapter(id, true);
      adapters.delete(id);
      const scope = o.secrets.scoped(id);
      await scope.delete("username");
      await scope.delete("password");
      o.store.state.tapo = o.store.state.tapo.filter((c) => c.cameraId !== cameraId);
      await o.store.save();
      return { ok: true };
    },

    async snapshot(deviceId: string): Promise<Buffer> {
      const a = byDevice(deviceId);
      try {
        return await streamFor(a).snapshot();
      } catch (e) {
        throw new SetupError(502, "NO_IMAGE", (e as Error).message);
      }
    },

    /** Abonnement op live beelden; geeft een afmeldfunctie terug. Een leeg beeld betekent: stream gestopt. */
    subscribe(deviceId: string, onFrame: (jpeg: Buffer) => void): () => void {
      return streamFor(byDevice(deviceId)).subscribe(onFrame);
    },

    /** Gooit 404 als dit geen toegevoegde camera is. */
    check(deviceId: string): void {
      byDevice(deviceId);
    },

    lastStreamError(deviceId: string): string | null {
      const a = adapters.get(deviceId.split(":")[0] ?? "");
      return a ? (streams.get(a.id)?.lastError ?? null) : null;
    },

    stopAll() {
      for (const s of streams.values()) s.stop();
    },
  };
}

export type CameraService = ReturnType<typeof createCameraService>;

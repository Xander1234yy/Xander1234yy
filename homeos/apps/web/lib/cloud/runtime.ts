import "server-only";
import { createConnector, registerStorage, unregisterStorage, type StorageBackend } from "@homeos/connector/cloud";
import { pgStorage } from "./storage";
import { workerSqlChecked } from "./db";

/**
 * Cloudmodus (Vercel + Supabase, zonder laptop): iedere aanvraag start de connector in dit proces, met opslag in
 * Supabase, en ruimt hem daarna op. Alleen cloud-integraties (Daikin, Smart Life/Tuya, SolarEdge, Zonneplan, Hue-cloud).
 */
export function cloudRuntimeEnabled(): boolean {
  return process.env.HOMEOS_CLOUD_RUNTIME === "true";
}

const silent = { info() {}, warn: (m: string) => console.warn(`[homeos] ${m}`), error: (m: string, meta?: unknown) => console.error(`[homeos] ${m}`, meta ?? "") };
const refs = new Map<string, number>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CloudConnector = Awaited<ReturnType<typeof createConnector>>;

export async function withCloudConnector<T>(
  householdId: string,
  fn: (c: CloudConnector, call: (path: string, init?: RequestInit) => Promise<Response>) => Promise<T>,
  storage?: StorageBackend,
): Promise<T> {
  if (!UUID.test(householdId)) throw new Error("Ongeldig huishouden");
  const secret = process.env.HOMEOS_CONNECTOR_SECRET;
  if (!secret || secret.length < 32) throw new Error("HOMEOS_CONNECTOR_SECRET ontbreekt of is te kort (min. 32 tekens)");
  const prefix = `db://${householdId}`;
  registerStorage(prefix, storage ?? pgStorage(householdId, await workerSqlChecked()));
  refs.set(prefix, (refs.get(prefix) ?? 0) + 1);
  const c = await createConnector(
    {
      host: "127.0.0.1",
      port: 0,
      dataDir: prefix,
      demo: process.env.HOMEOS_CLOUD_DEMO === "true",
      masterSecret: secret,
      pollIntervalMs: 60_000,
      rateLimitPerMin: 10_000,
      commandLimitPerMin: 1_000,
      production: process.env.NODE_ENV === "production",
      serverless: true,
    },
    silent,
  );
  try {
    const addr = await c.start();
    const call = (path: string, init: RequestInit = {}) =>
      fetch(`http://127.0.0.1:${addr.port}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${c.identity.apiToken}`, "content-type": "application/json" },
        signal: init.signal ?? AbortSignal.timeout(55_000),
      });
    return await fn(c, call);
  } finally {
    await c.flush().catch((e) => silent.error("Wegschrijven mislukt", String(e)));
    await c.stop().catch(() => undefined);
    const n = (refs.get(prefix) ?? 1) - 1;
    if (n <= 0) {
      refs.delete(prefix);
      unregisterStorage(prefix);
    } else refs.set(prefix, n);
  }
}

/** Eén verzoek aan de connector van dit huishouden; het antwoord wordt volledig gelezen vóór de connector stopt. */
export async function cloudConnectorFetch(householdId: string, path: string, init: RequestInit = {}): Promise<Response> {
  return withCloudConnector(householdId, async (_c, call) => {
    const res = await call(path, init);
    const body = await res.arrayBuffer();
    return new Response(body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
  });
}

/**
 * Een doorlopende stroom (bijv. live camerabeeld) van de connector van dit huishouden. De connector blijft draaien
 * tot de stroom eindigt of de kijker afhaakt (`signal`); het antwoord begint zodra de connector een status geeft.
 */
export function cloudConnectorStream(householdId: string, path: string, signal: AbortSignal): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let started = false;
    void withCloudConnector(householdId, async (_c, call) => {
      const res = await call(path, { signal });
      if (!res.ok || !res.body) {
        started = true;
        resolve(new Response(await res.arrayBuffer(), { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } }));
        return;
      }
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      started = true;
      const headers = new Headers({ "content-type": res.headers.get("content-type") ?? "application/octet-stream" });
      for (const h of ["x-audio-codec", "x-audio-rate"]) {
        const v = res.headers.get(h);
        if (v) headers.set(h, v);
      }
      resolve(new Response(readable, { status: 200, headers }));
      await res.body.pipeTo(writable, { signal }).catch(() => undefined);
    }).catch((e) => {
      if (!started) reject(e);
    });
  });
}

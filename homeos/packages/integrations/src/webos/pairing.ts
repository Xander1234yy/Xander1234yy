import { createHash } from "node:crypto";
import { isPrivateLanHost } from "../hue/net";
import { WebOsClient, WebOsError } from "./client";
import { EP, macFromConnectionInfo, parseMac } from "./protocol";

export interface TvRecordInfo {
  tvId: string;
  host: string;
  name: string;
  model: string;
  scheme: "wss" | "ws";
  fingerprint256: string | null;
  mac: string | null;
}

export type TvPairResult = { ok: true; tv: TvRecordInfo; clientKey: string } | { ok: false; code: string; message: string };

export interface PairOptions {
  manualMac?: string | null;
  /** Alleen voor tests. */
  ports?: { wssPort?: number; wsPort?: number };
  promptTimeoutMs?: number;
  allowInsecure?: boolean;
  /** Alleen voor tests (simulator op 127.0.0.1). */
  hostCheck?: (host: string) => boolean;
}

/**
 * Koppelt een LG-tv: verbinden (eerst versleuteld), registreren (de tv toont een melding die de gebruiker
 * bevestigt), dan model en MAC-adres uitlezen voor aanzetten via het netwerk.
 */
export async function pairTv(host: string, opts: PairOptions = {}): Promise<TvPairResult> {
  if (!(opts.hostCheck ?? isPrivateLanHost)(host)) return { ok: false, code: "INVALID_HOST", message: "Gebruik het lokale IP-adres van de tv (bijv. 192.168.68.20)." };
  let client: WebOsClient | null = null;
  let scheme: "wss" | "ws" = "wss";
  try {
    client = new WebOsClient({ host, fingerprint256: null, scheme: "wss", ...opts.ports });
    try {
      await client.open();
    } catch (e) {
      if (!opts.allowInsecure || (e instanceof WebOsError && e.code === "CERTIFICATE")) throw e;
      scheme = "ws";
      client = new WebOsClient({ host, fingerprint256: null, scheme: "ws", ...opts.ports });
      await client.open();
    }
    const clientKey = await client.register(null, { allowPrompt: true, promptTimeoutMs: opts.promptTimeoutMs ?? 60_000 });
    const info = await client.request(EP.systemInfo).catch(() => ({}) as Record<string, unknown>);
    const conn = await client.request(EP.connectionInfo).catch(() => undefined);
    const mac = parseMac(opts.manualMac) ?? macFromConnectionInfo(conn);
    const model = typeof info.modelName === "string" ? info.modelName.slice(0, 80) : "webOS TV";
    const idSource = mac ?? client.fingerprint256 ?? host;
    const tvId = createHash("sha256").update(idSource).digest("hex").slice(0, 16);
    return {
      ok: true,
      clientKey,
      tv: { tvId, host, name: `LG ${model}`.slice(0, 80), model, scheme, fingerprint256: client.fingerprint256, mac },
    };
  } catch (e) {
    const err = e instanceof WebOsError ? e : new WebOsError((e as Error).message, "PROTOCOL");
    const hint =
      err.code === "UNREACHABLE"
        ? " Staat de tv aan en zit hij op hetzelfde netwerk? Controleer ook of 'LG Connect Apps' aan staat (Instellingen → Algemeen → Mobiele tv aan / Externe apparaten)."
        : "";
    return { ok: false, code: err.code, message: `${err.message}.${hint}`.replace("..", ".") };
  } finally {
    client?.close();
  }
}

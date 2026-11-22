import { createHueHttp, fetchPeerCertificate, isPrivateLanHost, type HueHttp } from "./net";

export interface DiscoveredBridge {
  id: string;
  host: string;
  source: "discovery" | "manual";
}

/** Officiële Philips Hue discovery-dienst. Maximaal 1 verzoek per 15 minuten; resultaat wordt gecachet. */
const DISCOVERY_URL = "https://discovery.meethue.com/";
let cache: { at: number; bridges: DiscoveredBridge[] } | null = null;

export async function discoverBridges(fetchImpl: typeof fetch = fetch): Promise<DiscoveredBridge[]> {
  if (cache && Date.now() - cache.at < 15 * 60_000) return cache.bridges;
  const res = await fetchImpl(DISCOVERY_URL, { signal: AbortSignal.timeout(6000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Discovery-dienst gaf status ${res.status}`);
  const list = (await res.json()) as { id?: string; internalipaddress?: string }[];
  const bridges = list
    .filter((b) => typeof b.id === "string" && typeof b.internalipaddress === "string" && isPrivateLanHost(b.internalipaddress))
    .map((b) => ({ id: b.id!.toLowerCase(), host: b.internalipaddress!, source: "discovery" as const }));
  cache = { at: Date.now(), bridges };
  return bridges;
}

export interface BridgeInfo {
  bridgeId: string;
  name: string;
  modelId: string;
  apiVersion: string;
}

export type PairResult =
  | { ok: true; bridge: BridgeInfo; fingerprint256: string; appKey: string; clientKey: string | null }
  | { ok: false; code: "LINK_BUTTON_NOT_PRESSED" | "NOT_A_HUE_BRIDGE" | "UNREACHABLE" | "INVALID_HOST" | "CERT_MISMATCH" | "FAILED"; message: string };

export interface PairDeps {
  peer?: typeof fetchPeerCertificate;
  http?: (host: string, fingerprint256: string) => HueHttp;
}

/**
 * Koppelt met een bridge volgens de officiële procedure: de gebruiker drukt op de link-knop en de connector
 * vraagt een application key aan (POST /api met generateclientkey). Het certificaat wordt vastgelegd (pinning).
 */
export async function pairBridge(host: string, deps: PairDeps = {}): Promise<PairResult> {
  if (!isPrivateLanHost(host)) return { ok: false, code: "INVALID_HOST", message: "Gebruik het lokale IP-adres van de bridge (bijv. 192.168.1.20)." };
  const peer = deps.peer ?? fetchPeerCertificate;
  const mkHttp = deps.http ?? ((h, fp) => createHueHttp({ host: h, fingerprint256: fp, appKey: null }));

  let cert;
  try {
    cert = await peer(host);
  } catch {
    return { ok: false, code: "UNREACHABLE", message: "De bridge is niet bereikbaar op dit adres." };
  }
  const http = mkHttp(host, cert.fingerprint256);

  let info: BridgeInfo;
  try {
    const cfg = await http.request<{ bridgeid?: string; name?: string; modelid?: string; apiversion?: string }>("GET", "/api/0/config");
    if (!cfg.body?.bridgeid) return { ok: false, code: "NOT_A_HUE_BRIDGE", message: "Dit apparaat lijkt geen Philips Hue Bridge te zijn." };
    info = { bridgeId: cfg.body.bridgeid.toLowerCase(), name: cfg.body.name ?? "Hue Bridge", modelId: cfg.body.modelid ?? "", apiVersion: cfg.body.apiversion ?? "" };
  } catch {
    return { ok: false, code: "NOT_A_HUE_BRIDGE", message: "Dit apparaat lijkt geen Philips Hue Bridge te zijn." };
  }
  // Hue-bridgecertificaten hebben de bridge-ID als Common Name. Wijkt die af, dan vertrouwen we het niet.
  if (cert.commonName && cert.commonName.toLowerCase() !== info.bridgeId) {
    return { ok: false, code: "CERT_MISMATCH", message: "Het certificaat hoort niet bij deze bridge. Koppelen afgebroken." };
  }
  if (info.modelId && info.modelId !== "BSB002" && !info.modelId.startsWith("BSB")) {
    return { ok: false, code: "NOT_A_HUE_BRIDGE", message: `Model ${info.modelId} wordt niet ondersteund. Gebruik een Hue Bridge (vierkant model).` };
  }

  try {
    const res = await http.request<{ success?: { username: string; clientkey?: string }; error?: { type: number; description: string } }[]>("POST", "/api", {
      devicetype: "homeos#connector",
      generateclientkey: true,
    });
    const first = res.body?.[0];
    if (first?.error?.type === 101) return { ok: false, code: "LINK_BUTTON_NOT_PRESSED", message: "Druk op de ronde knop op de bridge en probeer het binnen 30 seconden opnieuw." };
    if (!first?.success?.username) return { ok: false, code: "FAILED", message: first?.error?.description ?? "Koppelen mislukt" };
    return { ok: true, bridge: info, fingerprint256: cert.fingerprint256, appKey: first.success.username, clientKey: first.success.clientkey ?? null };
  } catch {
    return { ok: false, code: "FAILED", message: "Koppelen mislukt. Controleer de verbinding met de bridge." };
  }
}

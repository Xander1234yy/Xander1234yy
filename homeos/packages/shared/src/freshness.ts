import type { Device } from "./device";

/** Na deze tijd zonder nieuwe uitlezing is een toestand niet meer "live". */
export const LIVE_THRESHOLD_MS = 90_000;

export type Freshness = "live" | "stale" | "unknown";

export function stateFreshness(
  device: Pick<Device, "status" | "stateUpdatedAt"> & { refreshIntervalMs?: number | null },
  opts: { connectorOnline: boolean; now?: number; thresholdMs?: number },
): Freshness {
  if (!device.stateUpdatedAt) return "unknown";
  if (!opts.connectorOnline) return "stale";
  if (device.status !== "ONLINE") return "stale";
  const age = (opts.now ?? Date.now()) - Date.parse(device.stateUpdatedAt);
  const threshold = opts.thresholdMs ?? Math.max(LIVE_THRESHOLD_MS, (device.refreshIntervalMs ?? 0) * 1.5);
  return age <= threshold ? "live" : "stale";
}

/** Status zoals de gebruiker hem moet zien: zonder connector weten we het simpelweg niet. */
export function effectiveStatus(device: Pick<Device, "status">, connectorOnline: boolean): Device["status"] {
  return connectorOnline ? device.status : "UNKNOWN";
}

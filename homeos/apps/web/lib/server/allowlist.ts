/**
 * Alleen deze connector-endpoints mogen via de webapp aangeroepen worden.
 * Alles wat niet expliciet in deze lijst staat wordt geweigerd.
 */
const seg = "[^/]+";
export const CONNECTOR_ALLOWLIST: { method: string; pattern: RegExp }[] = [
  { method: "GET", pattern: /^v1\/snapshot$/ },
  { method: "GET", pattern: /^v1\/devices\/available$/ },
  { method: "POST", pattern: /^v1\/discover$/ },
  { method: "POST", pattern: new RegExp(`^v1/devices/${seg}/add$`) },
  { method: "PATCH", pattern: new RegExp(`^v1/devices/${seg}$`) },
  { method: "DELETE", pattern: new RegExp(`^v1/devices/${seg}$`) },
  { method: "POST", pattern: new RegExp(`^v1/devices/${seg}/commands$`) },
  { method: "POST", pattern: new RegExp(`^v1/devices/${seg}/sync$`) },
  { method: "POST", pattern: /^v1\/sync$/ },
  { method: "POST", pattern: new RegExp(`^v1/scenes/${seg}/activate$`) },
  { method: "POST", pattern: /^v1\/rooms$/ },
  { method: "PATCH", pattern: new RegExp(`^v1/rooms/${seg}$`) },
  { method: "DELETE", pattern: new RegExp(`^v1/rooms/${seg}$`) },
  { method: "GET", pattern: /^v1\/energy\/summary$/ },
  { method: "GET", pattern: /^v1\/energy\/history$/ },
  { method: "GET", pattern: /^v1\/events$/ },
  { method: "GET", pattern: /^v1\/audit$/ },
  { method: "POST", pattern: /^v1\/emergency-stop$/ },
  { method: "GET", pattern: /^v1\/integrations$/ },
  { method: "POST", pattern: /^v1\/integrations\/hue\/discover$/ },
  { method: "POST", pattern: /^v1\/integrations\/hue\/pair$/ },
  { method: "DELETE", pattern: new RegExp(`^v1/integrations/hue/[0-9a-f]{16}$`) },
  { method: "POST", pattern: /^v1\/integrations\/webos\/(discover|pair)$/ },
  { method: "GET", pattern: /^v1\/cameras$/ },
  { method: "POST", pattern: /^v1\/integrations\/tapo$/ },
  { method: "DELETE", pattern: /^v1\/integrations\/tapo\/[0-9a-f]{16}$/ },
  { method: "DELETE", pattern: /^v1\/integrations\/webos\/[0-9a-f]{16}$/ },
  { method: "POST", pattern: /^v1\/integrations\/solaredge$/ },
  { method: "DELETE", pattern: /^v1\/integrations\/solaredge\/\d{1,12}$/ },
  { method: "POST", pattern: /^v1\/integrations\/daikin\/(start|complete)$/ },
  { method: "DELETE", pattern: /^v1\/integrations\/daikin$/ },
  { method: "POST", pattern: /^v1\/integrations\/tuya$/ },
  { method: "DELETE", pattern: /^v1\/integrations\/tuya$/ },
  { method: "POST", pattern: /^v1\/integrations\/matter\/commission$/ },
  { method: "GET", pattern: /^v1\/automations(\/(templates|runs))?$/ },
  { method: "POST", pattern: /^v1\/automations$/ },
  { method: "PATCH", pattern: new RegExp(`^v1/automations/${seg}$`) },
  { method: "DELETE", pattern: new RegExp(`^v1/automations/${seg}$`) },
  { method: "POST", pattern: new RegExp(`^v1/automations/${seg}/run$`) },
  { method: "GET", pattern: /^v1\/notifications(\/preferences)?$/ },
  { method: "POST", pattern: /^v1\/notifications\/read$/ },
  { method: "PUT", pattern: /^v1\/notifications\/preferences$/ },
  { method: "DELETE", pattern: /^v1\/integrations\/matter\/nodes\/\d{1,20}$/ },
];

export function isAllowed(method: string, path: string): boolean {
  if (path.includes("..") || path.includes("//")) return false;
  return CONNECTOR_ALLOWLIST.some((r) => r.method === method && r.pattern.test(path));
}

/** Bescherming tegen CSRF: wijzigende verzoeken moeten van dezelfde origin komen. */
export function isSameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
}

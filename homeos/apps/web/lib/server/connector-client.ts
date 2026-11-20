import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Server-side client voor de lokale Device Connector.
 * Het connector-token komt uit een server-side omgevingsvariabele of (alleen in ontwikkeling)
 * uit het tokenbestand van de connector op dezelfde laptop. Het komt nooit in de browser.
 */
export const CONNECTOR_URL = (process.env.HOMEOS_CONNECTOR_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const TIMEOUT_MS = 6_000;

let cachedToken: string | null = null;

async function resolveToken(force = false): Promise<string | null> {
  if (process.env.HOMEOS_CONNECTOR_TOKEN) return process.env.HOMEOS_CONNECTOR_TOKEN;
  if (cachedToken && !force) return cachedToken;
  if (process.env.NODE_ENV === "production" && !process.env.HOMEOS_CONNECTOR_TOKEN_FILE) return null;
  const file = process.env.HOMEOS_CONNECTOR_TOKEN_FILE ?? path.resolve(process.cwd(), "../connector/.data/api-token");
  try {
    cachedToken = (await readFile(/*turbopackIgnore: true*/ file, "utf8")).trim() || null;
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

export class ConnectorUnavailableError extends Error {
  constructor(
    message: string,
    public readonly reason: "unreachable" | "no_token" | "unauthorized" | "timeout",
  ) {
    super(message);
  }
}

export async function connectorFetch(pathname: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await resolveToken();
  if (!token) throw new ConnectorUnavailableError("Geen connector-token geconfigureerd", "no_token");
  let res: Response;
  try {
    res = await fetch(CONNECTOR_URL + pathname, {
      ...init,
      cache: "no-store",
      signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS),
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new ConnectorUnavailableError(
      timeout ? "Connector reageert niet op tijd" : "Connector is niet bereikbaar",
      timeout ? "timeout" : "unreachable",
    );
  }
  if (res.status === 401) {
    // Token mogelijk vernieuwd: één keer opnieuw inlezen.
    if (retry && (await resolveToken(true)) !== token) return connectorFetch(pathname, init, false);
    throw new ConnectorUnavailableError("Connector weigert het token", "unauthorized");
  }
  return res;
}

export async function getConnectorToken(): Promise<string | null> {
  return resolveToken();
}

export function connectorWsUrl(): string {
  return CONNECTOR_URL.replace(/^http/, "ws") + "/v1/ws";
}

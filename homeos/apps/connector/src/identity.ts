import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { readFileOrNull, writeFileAtomic } from "./fs-utils";

const IdentitySchema = z.object({ connectorId: z.uuid(), createdAt: z.string() });
export type ConnectorIdentity = z.infer<typeof IdentitySchema> & { apiToken: string };

export const TOKEN_FILE = "api-token";

/**
 * Unieke connectoridentiteit + API-token. Het token staat alleen in de datamap (0600) en
 * wordt server-side door de HomeOS webapp gebruikt — nooit in de browser.
 */
export async function loadOrCreateIdentity(dataDir: string): Promise<ConnectorIdentity> {
  const idFile = path.join(dataDir, "identity.json");
  const tokenFile = path.join(dataDir, TOKEN_FILE);
  let identity = parseIdentity(await readFileOrNull(idFile));
  if (!identity) {
    identity = { connectorId: randomUUID(), createdAt: new Date().toISOString() };
    await writeFileAtomic(idFile, JSON.stringify(identity, null, 2));
  }
  let apiToken = (await readFileOrNull(tokenFile))?.trim() ?? "";
  if (apiToken.length < 32) {
    apiToken = randomBytes(32).toString("base64url");
    await writeFileAtomic(tokenFile, apiToken + "\n");
  }
  return { ...identity, apiToken };
}

export async function rotateToken(dataDir: string): Promise<string> {
  const apiToken = randomBytes(32).toString("base64url");
  await writeFileAtomic(path.join(dataDir, TOKEN_FILE), apiToken + "\n");
  return apiToken;
}

function parseIdentity(raw: string | null) {
  if (!raw) return null;
  try {
    const r = IdentitySchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Timing-safe vergelijking van tokens. */
export function tokensEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

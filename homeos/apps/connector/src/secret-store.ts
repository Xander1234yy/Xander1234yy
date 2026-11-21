import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { SecretAccess } from "@homeos/integrations";
import { readFileOrNull, writeFileAtomic, joinPath } from "./fs-utils";

/**
 * Versleutelde lokale opslag (AES-256-GCM) voor integratietokens, zoals de Hue application key.
 * De sleutel komt uit HOMEOS_CONNECTOR_SECRET of uit een lokaal sleutelbestand (0600).
 * Secrets verlaten deze laptop nooit.
 */
export class SecretStore {
  private cache: Record<string, string> | null = null;
  private key: Buffer | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly masterSecret: string | null,
  ) {}

  private async getKey(): Promise<Buffer> {
    if (this.key) return this.key;
    let secret = this.masterSecret;
    if (!secret) {
      const keyFile = joinPath(this.dataDir, "master.key");
      secret = (await readFileOrNull(keyFile))?.trim() ?? null;
      if (!secret) {
        secret = randomBytes(32).toString("base64url");
        await writeFileAtomic(keyFile, secret + "\n");
      }
    }
    this.key = scryptSync(secret, "homeos-connector-secrets-v1", 32);
    return this.key;
  }

  private get file() {
    return joinPath(this.dataDir, "secrets.enc");
  }

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache;
    const raw = await readFileOrNull(this.file);
    if (!raw) return (this.cache = {});
    const buf = Buffer.from(raw.trim(), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", await this.getKey(), iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return (this.cache = JSON.parse(json) as Record<string, string>);
  }

  private async save(values: Record<string, string>): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", await this.getKey(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(values), "utf8"), cipher.final()]);
    const out = Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
    await writeFileAtomic(this.file, out);
    this.cache = values;
  }

  /** Alleen voor het overzetten naar de cloud: alle sleutels (ontsleuteld, in het geheugen). */
  async exportAll(): Promise<Record<string, string>> {
    return { ...(await this.load()) };
  }

  /** Voegt sleutels toe (bestaande met dezelfde naam worden overschreven) en slaat versleuteld op. */
  async importAll(values: Record<string, string>): Promise<void> {
    await this.save({ ...(await this.load()), ...values });
  }

  /** Afgeschermde toegang per adapter: een adapter ziet alleen de eigen sleutels. */
  scoped(namespace: string): SecretAccess {
    const k = (key: string) => `${namespace}:${key}`;
    return {
      get: async (key) => (await this.load())[k(key)] ?? null,
      set: async (key, value) => this.save({ ...(await this.load()), [k(key)]: value }),
      delete: async (key) => {
        const next = { ...(await this.load()) };
        delete next[k(key)];
        await this.save(next);
      },
    };
  }
}

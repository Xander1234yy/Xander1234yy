import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_DIR = path.resolve(here, "../.data");

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  HOMEOS_CONNECTOR_HOST: z.string().default("127.0.0.1"),
  HOMEOS_CONNECTOR_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOMEOS_DATA_DIR: z.string().optional(),
  HOMEOS_DEMO: bool.optional(),
  HOMEOS_CONNECTOR_SECRET: z.string().min(32).optional(),
  HOMEOS_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),
  HOMEOS_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(10).default(300),
  HOMEOS_COMMAND_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(150),
});

export interface ConnectorConfig {
  host: string;
  port: number;
  dataDir: string;
  demo: boolean;
  masterSecret: string | null;
  pollIntervalMs: number;
  rateLimitPerMin: number;
  commandLimitPerMin: number;
  production: boolean;
  /**
   * Cloudmodus: de connector draait per aanvraag in een serverless functie (Vercel), met opslag in Supabase
   * (dataDir = "db://<huishouden>"). Geen timers, geen lokale integraties (Hue-bridge, tv, camera, Matter).
   */
  serverless?: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConnectorConfig {
  const e = EnvSchema.parse(env);
  const production = e.NODE_ENV === "production";
  return {
    host: e.HOMEOS_CONNECTOR_HOST,
    port: e.HOMEOS_CONNECTOR_PORT,
    dataDir: path.resolve(e.HOMEOS_DATA_DIR ?? DEFAULT_DATA_DIR),
    // Demo staat standaard aan in ontwikkeling en uit in productie.
    demo: e.HOMEOS_DEMO ?? !production,
    masterSecret: e.HOMEOS_CONNECTOR_SECRET ?? null,
    pollIntervalMs: e.HOMEOS_POLL_INTERVAL_MS,
    rateLimitPerMin: e.HOMEOS_RATE_LIMIT_PER_MIN,
    commandLimitPerMin: e.HOMEOS_COMMAND_LIMIT_PER_MIN,
    production,
  };
}

export const CONNECTOR_VERSION = "0.1.0";

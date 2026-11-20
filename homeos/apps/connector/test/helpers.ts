import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConnector } from "../src/app";
import type { ConnectorConfig } from "../src/config";

export const silent = { info() {}, warn() {}, error() {} };

export async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "homeos-test-"));
}

export async function startTestConnector(overrides: Partial<ConnectorConfig> = {}) {
  const dataDir = overrides.dataDir ?? (await tempDir());
  const config: ConnectorConfig = {
    host: "127.0.0.1",
    port: 0,
    dataDir,
    demo: true,
    masterSecret: null,
    pollIntervalMs: 60_000,
    rateLimitPerMin: 1000,
    commandLimitPerMin: 1000,
    production: false,
    ...overrides,
  };
  const c = await createConnector(config, silent);
  const addr = await c.start();
  const base = `http://127.0.0.1:${addr.port}`;
  const token = c.identity.apiToken;
  const call = (p: string, init: RequestInit = {}) =>
    fetch(base + p, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  return {
    c,
    base,
    token,
    port: addr.port,
    dataDir,
    call,
    async close(removeDir = true) {
      await c.stop();
      if (removeDir) await rm(dataDir, { recursive: true, force: true });
    },
  };
}

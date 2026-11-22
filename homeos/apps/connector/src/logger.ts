import { appendFile } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "@homeos/integrations";

/** Logt naar de console en naar een lokaal logbestand. Nooit tokens of secrets loggen. */
export function createLogger(dataDir: string | null, opts: { quiet?: boolean } = {}): Logger {
  const file = dataDir ? path.join(dataDir, "logs", "connector.log") : null;
  const write = (level: string, msg: string, meta?: Record<string, unknown>) => {
    const line = JSON.stringify({ at: new Date().toISOString(), level, msg, ...(meta ?? {}) });
    if (!opts.quiet) {
      const out = level === "error" ? console.error : console.log;
      out(`[connector] ${level.toUpperCase()} ${msg}${meta ? " " + JSON.stringify(meta) : ""}`);
    }
    if (file) void appendFile(file, line + "\n", { mode: 0o600 }).catch(() => undefined);
  };
  return {
    info: (m, meta) => write("info", m, meta),
    warn: (m, meta) => write("warn", m, meta),
    error: (m, meta) => write("error", m, meta),
  };
}

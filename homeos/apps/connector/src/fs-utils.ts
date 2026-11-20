import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Opslag van de connector. Standaard bestanden in de datamap (MacBook). In de cloudmodus is de "datamap" een virtueel
 * pad zoals `db://<huishouden>`; dan gaat alles naar een geregistreerde opslag (Supabase, zie apps/web/lib/cloud).
 */
export interface StorageBackend {
  read(key: string): Promise<string | null>;
  write(key: string, data: string): Promise<void>;
  append(key: string, line: string): Promise<void>;
  /** Laatste n regels, oudste eerst. */
  tail(key: string, n: number): Promise<string[]>;
}

const backends = new Map<string, StorageBackend>();

/** Registreert een opslag voor een virtuele datamap (bijv. "db://<id>"). */
export function registerStorage(prefix: string, backend: StorageBackend): void {
  if (!prefix.startsWith("db://")) throw new Error("Alleen db:// wordt ondersteund");
  backends.set(prefix.replace(/\/+$/, ""), backend);
}
export function unregisterStorage(prefix: string): void {
  backends.delete(prefix.replace(/\/+$/, ""));
}

function virtual(file: string): { backend: StorageBackend; key: string } | null {
  if (!file.startsWith("db://")) return null;
  for (const [prefix, backend] of backends) {
    if (file === prefix || file.startsWith(`${prefix}/`)) return { backend, key: file.slice(prefix.length + 1) || "." };
  }
  throw new Error(`Geen opslag geregistreerd voor ${file.split("/").slice(0, 3).join("/")}`);
}

/** path.join die db://-paden heel laat (path.join zou "db://" inkorten tot "db:/"). */
export function joinPath(dir: string, ...parts: string[]): string {
  return dir.startsWith("db://") ? [dir.replace(/\/+$/, ""), ...parts].join("/") : path.join(dir, ...parts);
}

/** Atomisch schrijven (tmp + rename), standaard alleen leesbaar voor de eigenaar. */
export async function writeFileAtomic(file: string, data: string | Buffer, mode = 0o600): Promise<void> {
  const v = virtual(file);
  if (v) return v.backend.write(v.key, data.toString());
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(tmp, data, { mode });
  await fs.rename(tmp, file);
}

export async function readFileOrNull(file: string): Promise<string | null> {
  const v = virtual(file);
  if (v) return v.backend.read(v.key);
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  if (dir.startsWith("db://")) return;
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}

export async function appendLine(file: string, line: string): Promise<void> {
  const v = virtual(file);
  if (v) return v.backend.append(v.key, line);
  await fs.appendFile(file, line + "\n", { mode: 0o600 });
}

export async function readLines(file: string, n: number): Promise<string[]> {
  const v = virtual(file);
  if (v) return v.backend.tail(v.key, n);
  try {
    return (await fs.readFile(file, "utf8")).trim().split("\n").filter(Boolean).slice(-n);
  } catch {
    return [];
  }
}

/** Opslag in het geheugen (tests). */
export function memoryStorage(): StorageBackend & { docs: Map<string, string>; logs: Map<string, string[]> } {
  const docs = new Map<string, string>();
  const logs = new Map<string, string[]>();
  return {
    docs,
    logs,
    read: async (k) => docs.get(k) ?? null,
    write: async (k, d) => void docs.set(k, d),
    append: async (k, l) => void logs.set(k, [...(logs.get(k) ?? []), l]),
    tail: async (k, n) => (logs.get(k) ?? []).slice(-n),
  };
}

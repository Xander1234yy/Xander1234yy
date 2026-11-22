import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../../supabase/migrations");

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(migrationsDir, f));
}

export async function createTestDb() {
  const db = new PGlite();
  await db.exec(readFileSync(path.join(here, "supabase-shim.sql"), "utf8"));
  for (const f of migrationFiles()) await db.exec(readFileSync(f, "utf8"));

  let n = 0;
  async function createUser(email: string, displayName?: string): Promise<string> {
    const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, email, displayName ? { display_name: displayName } : {}]);
    return id;
  }

  /** Voer een query uit als ingelogde gebruiker (rol authenticated, RLS actief). */
  async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
    return db.transaction(async (tx) => {
      await tx.query(`set local role ${uid ? "authenticated" : "anon"}`);
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
      const r = await tx.query<T>(sql, params);
      return r.rows;
    });
  }

  /** Voer een query uit met een databaserol (bijv. de beperkte cloud-rol homeos_worker). */
  async function asRole<T = Record<string, unknown>>(role: string, sql: string, params: unknown[] = []): Promise<T[]> {
    return db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      const r = await tx.query<T>(sql, params);
      return r.rows;
    });
  }

  return { db, createUser, as, asRole };
}

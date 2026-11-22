#!/usr/bin/env node
// Past de SQL-migraties uit supabase/migrations toe op een Postgres/Supabase-database.
// Gebruik:  SUPABASE_DB_URL=postgresql://... npm run db:migrate   [-- --status]
// Houdt dezelfde administratie bij als de Supabase CLI (supabase_migrations.schema_migrations),
// zodat je later ook `supabase db push` kunt gebruiken.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "supabase", "migrations");
const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
const statusOnly = process.argv.includes("--status");

if (!url) {
  console.error("Zet SUPABASE_DB_URL (Supabase → Project Settings → Database → Connection string). Zie docs/supabase.md.");
  process.exit(1);
}

const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(`create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
  const done = new Set((await client.query("select version from supabase_migrations.schema_migrations")).rows.map((r) => r.version));
  let applied = 0;
  for (const f of files) {
    const [version, ...rest] = f.replace(/\.sql$/, "").split("_");
    const name = rest.join("_");
    if (done.has(version)) {
      console.log(`  ✓ ${f}`);
      continue;
    }
    if (statusOnly) {
      console.log(`  • ${f} (nog niet toegepast)`);
      continue;
    }
    const sql = readFileSync(path.join(dir, f), "utf8");
    process.stdout.write(`  → ${f} … `);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)", [version, name, [sql]]);
      await client.query("commit");
      console.log("ok");
      applied++;
    } catch (err) {
      await client.query("rollback");
      console.log("MISLUKT");
      throw err;
    }
  }
  if (!statusOnly) console.log(applied ? `${applied} migratie(s) toegepast.` : "Database is up-to-date.");
} finally {
  await client.end();
}

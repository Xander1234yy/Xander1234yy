#!/usr/bin/env node
// Richt de cloudmodus in (HomeOS zonder laptop: Vercel + Supabase).
//
//   SUPABASE_DB_URL='postgresql://postgres:<wachtwoord>@db.<ref>.supabase.co:5432/postgres' \
//     npm run cloud:setup -- --url https://jouw-homeos.vercel.app
//
// Doet: migraties toepassen, een beperkte database-login voor HomeOS (homeos_worker_login, lid van homeos_worker)
// met een willekeurig wachtwoord, en een geplande taak (pg_cron + pg_net) die elke minuut /api/cloud/tick aanroept.
// Schrijft de waarden voor Vercel naar .homeos-cloud.env (alleen voor jou leesbaar). Toont geen geheimen op het scherm.
// Opnieuw draaien hergebruikt de bestaande geheimen; nieuwe maken met --rotate.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".homeos-cloud.env");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const dbUrl = process.env.SUPABASE_DB_URL;
const appUrl = (arg("--url") ?? "").replace(/\/+$/, "");
const rotate = process.argv.includes("--rotate");

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!dbUrl) fail("Zet SUPABASE_DB_URL (Supabase → Connect → Direct connection, met je databasewachtwoord).");
if (!/^https:\/\/[a-z0-9.-]+$/i.test(appUrl)) fail("Geef het adres van je Vercel-app mee: --url https://jouw-homeos.vercel.app");

const old =
  existsSync(envFile) && !rotate
    ? Object.fromEntries(
        readFileSync(envFile, "utf8")
          .split("\n")
          .filter((l) => l.includes("=") && !l.startsWith("#"))
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
      )
    : {};
const secret = (k, bytes) => old[k] || randomBytes(bytes).toString("base64url");
const connectorSecret = secret("HOMEOS_CONNECTOR_SECRET", 48);
const cronSecret = secret("HOMEOS_CRON_SECRET", 48);
const workerPassword = old.__WORKER_PASSWORD || randomBytes(32).toString("hex");

console.log("→ Migraties toepassen…");
execFileSync(process.execPath, [path.join(root, "scripts", "db-migrate.mjs")], { stdio: "inherit", env: { ...process.env, SUPABASE_DB_URL: dbUrl } });

const client = new pg.Client({ connectionString: dbUrl, ssl: /localhost|127\.0\.0\.1/.test(dbUrl) ? false : { rejectUnauthorized: false } });
await client.connect();
try {
  console.log("→ Beperkte database-login voor HomeOS…");
  if (!/^[0-9a-f]{64}$/.test(workerPassword)) fail("Ongeldig wachtwoord gegenereerd");
  const exists = (await client.query("select 1 from pg_roles where rolname = 'homeos_worker_login'")).rowCount > 0;
  // CREATE/ALTER ROLE ondersteunt geen parameters; het wachtwoord bestaat alleen uit hex-tekens, dus veilig als literal.
  await client.query(exists ? `alter role homeos_worker_login with login password '${workerPassword}'` : `create role homeos_worker_login login password '${workerPassword}'`);
  await client.query("grant homeos_worker to homeos_worker_login");

  console.log("→ Geplande taak (elke minuut)…");
  await client.query("create extension if not exists pg_cron");
  await client.query("create extension if not exists pg_net");
  await client.query("select cron.unschedule(jobid) from cron.job where jobname = 'homeos-tick'");
  if (!/^[\w-]+$/.test(cronSecret)) fail("Ongeldig cron-geheim");
  const body = `select net.http_post(url := '${appUrl}/api/cloud/tick', headers := jsonb_build_object('authorization', 'Bearer ${cronSecret}', 'content-type', 'application/json'), body := '{}'::jsonb, timeout_milliseconds := 55000)`;
  await client.query("select cron.schedule('homeos-tick', '* * * * *', $1)", [body]);
} finally {
  await client.end();
}

// Adres voor de beperkte login: zelfde database. Bij de Supabase-pooler heet de gebruiker <rol>.<project-ref>.
const u = new URL(dbUrl);
const ref = u.username.split(".")[1] ?? u.hostname.match(/^db\.([a-z0-9]+)\./)?.[1] ?? "";
const worker = new URL(dbUrl);
worker.username = u.hostname.includes("pooler.supabase.com") ? `homeos_worker_login.${ref}` : "homeos_worker_login";
worker.password = workerPassword;

const lines = [
  "# Waarden voor Vercel (Project → Settings → Environment Variables). NIET delen of committen.",
  "HOMEOS_CLOUD_RUNTIME=true",
  `HOMEOS_SITE_URL=${appUrl}`,
  `HOMEOS_CONNECTOR_SECRET=${connectorSecret}`,
  `HOMEOS_CRON_SECRET=${cronSecret}`,
  `HOMEOS_WORKER_DB_URL=${worker.toString()}`,
  "SUPABASE_URL=https://<project-ref>.supabase.co",
  "SUPABASE_PUBLISHABLE_KEY=<publishable key uit Supabase → Project Settings → API Keys>",
  "# Alleen voor dit script (niet in Vercel zetten):",
  `__WORKER_PASSWORD=${workerPassword}`,
];
writeFileSync(envFile, lines.join("\n") + "\n", { mode: 0o600 });
chmodSync(envFile, 0o600);
console.log(`✓ Klaar. De waarden voor Vercel staan in ${path.relative(process.cwd(), envFile) || envFile} (alleen voor jou leesbaar).`);
console.log("  Vul SUPABASE_URL en SUPABASE_PUBLISHABLE_KEY aan en zet alles behalve __WORKER_PASSWORD in Vercel.");
if (!u.hostname.includes("pooler.supabase.com")) {
  console.log("  Tip: Vercel kan vaak geen IPv6 (directe verbinding). Gebruik voor HOMEOS_WORKER_DB_URL dan de");
  console.log("  'Transaction pooler' (poort 6543) uit Supabase → Connect, met gebruiker homeos_worker_login.<project-ref>.");
}

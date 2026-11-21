/**
 * Zet de instellingen van de connector op de MacBook over naar de cloudmodus (Supabase), voor één huishouden.
 * Alleen wat in de cloud werkt: SolarEdge, Daikin, Smart Life/Tuya, Zonneplan en Hue-cloud, met hun (opnieuw
 * versleutelde) sleutels, de apparaatnamen/-kamers en de automatiseringen. Lokale koppelingen (Hue-bridge, LG-tv,
 * Tapo-camera, Matter) en pushabonnementen gaan niet mee: die werken alleen thuis of horen bij het oude adres.
 *
 *   npm run cloud:import -- --env homeos-cloud-import.env --household <uuid> [--data apps/connector/.data] [--dry-run]
 *   (of HOMEOS_WORKER_DB_URL en HOMEOS_CLOUD_CONNECTOR_SECRET als omgevingsvariabelen)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { joinPath, readFileOrNull, registerStorage, unregisterStorage, writeFileAtomic, type StorageBackend } from "./fs-utils";
import { IntegrationsStore } from "./integrations-store";
import { SecretStore } from "./secret-store";
import { StateStore } from "./state-store";

/** Sleutelgroepen (scopes) en adapter-id's die in de cloud werken. */
const CLOUD_SCOPE = /^(solaredge-\d+|daikin-onecta|tuya|zonneplan-[0-9a-f]{6}|huecloud|googlehome|icloud-calendar|ziggo)$/;
const deviceAdapter = (deviceId: string) => deviceId.split(":")[0] ?? "";

export interface ImportSummary {
  integrations: string[];
  skipped: string[];
  secrets: number;
  devices: number;
  automations: number;
}

export async function importToCloud(o: {
  localDir: string;
  localSecret: string | null;
  householdId: string;
  cloudSecret: string;
  storage: StorageBackend;
  dryRun?: boolean;
}): Promise<ImportSummary> {
  if (!/^[0-9a-f-]{36}$/i.test(o.householdId)) throw new Error("Ongeldig huishouden");
  if (o.cloudSecret.length < 32) throw new Error("HOMEOS_CLOUD_CONNECTOR_SECRET ontbreekt of is te kort");

  // ── lokaal lezen
  const local = await IntegrationsStore.open(o.localDir);
  const localState = await StateStore.open(o.localDir);
  const localSecrets = await new SecretStore(o.localDir, o.localSecret).exportAll();
  const localAutomations = await readFileOrNull(path.join(o.localDir, "automations.json"));

  const s = local.state;
  const integrations: string[] = [];
  const skipped: string[] = [];
  if (s.solaredge.length) integrations.push(`SolarEdge (${s.solaredge.length})`);
  if (s.daikin) integrations.push("Daikin Onecta");
  if (s.tuya) integrations.push("Smart Life/Tuya");
  if (s.zonneplan) integrations.push("Zonneplan Connect");
  if (s.huecloud) integrations.push("Hue-cloud");
  if (s.googlehome) integrations.push("Google Home");
  if (s.icloud) integrations.push("Apple-agenda");
  if (s.hue.length) skipped.push("Philips Hue-bridge (lokaal; koppel opnieuw via Hue-cloud)");
  if (s.webos.length) skipped.push("LG-tv (alleen thuis)");
  if (s.tapo.length) skipped.push("Tapo-camera (alleen thuis)");
  if (s.matter) skipped.push("Matter (alleen thuis)");

  const secrets = Object.fromEntries(Object.entries(localSecrets).filter(([k]) => CLOUD_SCOPE.test(k.slice(0, k.indexOf(":")))));
  const devices = Object.fromEntries(Object.entries(localState.state.devices).filter(([id]) => CLOUD_SCOPE.test(deviceAdapter(id))));
  let automations = 0;
  if (localAutomations) {
    try {
      automations = (JSON.parse(localAutomations) as { automations?: unknown[] }).automations?.length ?? 0;
    } catch {
      automations = 0;
    }
  }
  const summary: ImportSummary = { integrations, skipped, secrets: Object.keys(secrets).length, devices: Object.keys(devices).length, automations };
  if (o.dryRun) return summary;

  // ── naar de cloud schrijven (versleuteld met de cloudsleutel)
  const prefix = `db://${o.householdId}`;
  registerStorage(prefix, o.storage);
  try {
    const cloudSecrets = new SecretStore(prefix, o.cloudSecret);
    await cloudSecrets.importAll(secrets);

    const cloud = await IntegrationsStore.open(prefix);
    cloud.state.solaredge = s.solaredge;
    cloud.state.daikin = s.daikin;
    cloud.state.tuya = s.tuya;
    cloud.state.zonneplan = s.zonneplan;
    cloud.state.huecloud = s.huecloud;
    cloud.state.googlehome = s.googlehome;
    cloud.state.icloud = s.icloud;
    cloud.state.shortcuts = s.shortcuts;
    cloud.state.ziggo = s.ziggo;
    await cloud.save();

    const cloudState = await StateStore.open(prefix);
    cloudState.state.devices = { ...cloudState.state.devices, ...devices };
    cloudState.state.emergencyStop = localState.state.emergencyStop;
    await cloudState.save();

    if (localAutomations) await writeFileAtomic(joinPath(prefix, "automations.json"), localAutomations);
  } finally {
    unregisterStorage(prefix);
  }
  return summary;
}

// ── opdrachtregel ──
async function main() {
  const arg = (n: string) => {
    const i = process.argv.indexOf(n);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const envFile = arg("--env");
  if (envFile) {
    const { readFile } = await import("node:fs/promises");
    for (const line of (await readFile(path.resolve(envFile), "utf8")).split("\n")) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!;
    }
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const localDir = path.resolve(arg("--data") ?? process.env.HOMEOS_DATA_DIR ?? path.join(here, "../.data"));
  const householdId = arg("--household") ?? process.env.HOMEOS_HOUSEHOLD_ID ?? "";
  const dryRun = process.argv.includes("--dry-run");
  const dbUrl = process.env.HOMEOS_WORKER_DB_URL;
  const cloudSecret = process.env.HOMEOS_CLOUD_CONNECTOR_SECRET ?? "";
  if (!dbUrl && !dryRun) throw new Error("Zet HOMEOS_WORKER_DB_URL (beperkte databaselogin van de cloudmodus)");

  const { default: pg } = await import("pg");
  const client = dbUrl ? new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } }) : null;
  if (client) await client.connect();
  const storage: StorageBackend = {
    read: async (k) => ((await client!.query("select data from public.cloud_documents where household_id = $1 and key = $2", [householdId, k])).rows[0]?.data as string) ?? null,
    write: async (k, d) => void (await client!.query("insert into public.cloud_documents (household_id, key, data) values ($1, $2, $3) on conflict (household_id, key) do update set data = excluded.data, updated_at = now()", [householdId, k, d])),
    append: async (k, l) => void (await client!.query("insert into public.cloud_logs (household_id, key, line) values ($1, $2, $3)", [householdId, k, l])),
    tail: async (k, n) => ((await client!.query("select line from public.cloud_logs where household_id = $1 and key = $2 order by id desc limit $3", [householdId, k, n])).rows as { line: string }[]).map((r) => r.line).reverse(),
  };
  try {
    const r = await importToCloud({ localDir, localSecret: process.env.HOMEOS_CONNECTOR_SECRET ?? null, householdId, cloudSecret, storage, dryRun });
    console.log(dryRun ? "Proefrun (er is niets geschreven):" : "✓ Overgezet naar de cloud:");
    console.log(`  Koppelingen: ${r.integrations.join(", ") || "geen"}`);
    console.log(`  Sleutels: ${r.secrets} · apparaten (namen/kamers): ${r.devices} · automatiseringen: ${r.automations}`);
    if (r.skipped.length) console.log(`  Niet overgezet: ${r.skipped.join("; ")}`);
  } finally {
    await client?.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  });
}

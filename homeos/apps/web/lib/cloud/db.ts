import "server-only";
import postgres from "postgres";
import { alternatePoolerUrl } from "./pooler";
export { alternatePoolerUrl };

/**
 * Databaseverbinding van de cloudmodus met de eigen, beperkte rol `homeos_worker` (géén service role key).
 * Die rol mag alleen de tabellen cloud_documents en cloud_logs gebruiken. Alleen server-side, na een autorisatie-
 * controle van de gebruiker, of vanuit de geplande taak met een eigen geheim.
 *
 * Supabase-projecten draaien achter een pooler op aws-0-<regio> of aws-1-<regio>. Meldt de pooler dat het project
 * niet bekend is ("Tenant or user not found"), dan probeert HomeOS eenmalig de andere en onthoudt die.
 */
type Sql = ReturnType<typeof postgres>;
let sql: Sql | null = null;
let checked: Promise<Sql> | null = null;

const make = (url: string) => postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10, onnotice: () => undefined });

export function workerSql(): Sql {
  const url = process.env.HOMEOS_WORKER_DB_URL;
  if (!url) throw new Error("HOMEOS_WORKER_DB_URL ontbreekt");
  sql ??= make(url);
  return sql;
}

/** Zoals workerSql, maar controleert eenmalig de verbinding en valt zo nodig terug op de andere pooler. */
export async function workerSqlChecked(): Promise<Sql> {
  checked ??= (async () => {
    const first = workerSql();
    try {
      await first`select 1`;
      return first;
    } catch (err) {
      const alt = alternatePoolerUrl(process.env.HOMEOS_WORKER_DB_URL!);
      if (!alt || !/tenant or user not found/i.test(String((err as Error).message))) throw err;
      const second = make(alt);
      await second`select 1`;
      await first.end({ timeout: 1 }).catch(() => undefined);
      sql = second;
      return second;
    }
  })().catch((e) => {
    checked = null;
    throw e;
  });
  return checked;
}

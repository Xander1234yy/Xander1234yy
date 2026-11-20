import "server-only";
import postgres from "postgres";

/**
 * Databaseverbinding van de cloudmodus met de eigen, beperkte rol `homeos_worker` (géén service role key).
 * Die rol mag alleen de tabellen cloud_documents en cloud_logs gebruiken. Alleen server-side, na een autorisatie-
 * controle van de gebruiker, of vanuit de geplande taak met een eigen geheim.
 */
let sql: ReturnType<typeof postgres> | null = null;

export function workerSql() {
  const url = process.env.HOMEOS_WORKER_DB_URL;
  if (!url) throw new Error("HOMEOS_WORKER_DB_URL ontbreekt");
  sql ??= postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10, onnotice: () => undefined });
  return sql;
}

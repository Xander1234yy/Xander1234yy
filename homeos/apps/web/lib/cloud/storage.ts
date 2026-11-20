import "server-only";
import type { StorageBackend } from "@homeos/connector/cloud";
import { workerSql } from "./db";

const MAX_DOC = 5_000_000;
const MAX_LINE = 20_000;

/** Connector-opslag per huishouden in Supabase (documenten + logregels). Al versleutelde geheimen blijven versleuteld. */
export function pgStorage(householdId: string, sql = workerSql()): StorageBackend {
  return {
    async read(key) {
      const rows = await sql<{ data: string }[]>`select data from public.cloud_documents where household_id = ${householdId} and key = ${key}`;
      return rows[0]?.data ?? null;
    },
    async write(key, data) {
      if (data.length > MAX_DOC) throw new Error(`Document te groot: ${key}`);
      await sql`insert into public.cloud_documents (household_id, key, data) values (${householdId}, ${key}, ${data})
                on conflict (household_id, key) do update set data = excluded.data, updated_at = now()`;
    },
    async append(key, line) {
      await sql`insert into public.cloud_logs (household_id, key, line) values (${householdId}, ${key}, ${line.slice(0, MAX_LINE)})`;
    },
    async tail(key, n) {
      const rows = await sql<{ line: string }[]>`select line from public.cloud_logs where household_id = ${householdId} and key = ${key} order by id desc limit ${n}`;
      return rows.map((r) => r.line).reverse();
    },
  };
}

/** Oude logregels opruimen (per logboek de nieuwste 2000 bewaren). */
export async function pruneLogs(householdId: string, sql = workerSql()) {
  await sql`delete from public.cloud_logs l using (
              select id from (select id, row_number() over (partition by key order by id desc) as rn
                              from public.cloud_logs where household_id = ${householdId}) x where x.rn > 2000) old
            where l.id = old.id`;
}

export async function cloudHouseholds(sql = workerSql()): Promise<string[]> {
  const rows = await sql<{ household_id: string }[]>`select distinct household_id from public.cloud_documents`;
  return rows.map((r) => r.household_id);
}

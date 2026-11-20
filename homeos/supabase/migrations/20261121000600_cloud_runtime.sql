-- Cloudmodus (zonder laptop): opslag van de connector per huishouden.
-- Gebruikers (anon/authenticated) hebben GEEN toegang: alleen de beperkte rol homeos_worker, die de webapp
-- server-side gebruikt ná een autorisatiecontrole, of de geplande taak met een eigen geheim. Geen service role key.
-- Geheimen (integratietokens) staan hierin alleen versleuteld (AES-256-GCM, sleutel alleen op de server).

create table public.cloud_documents (
  household_id uuid not null references public.households (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 200),
  data text not null check (char_length(data) <= 5000000),
  updated_at timestamptz not null default now(),
  primary key (household_id, key)
);

create table public.cloud_logs (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 200),
  line text not null check (char_length(line) <= 20000),
  created_at timestamptz not null default now()
);
create index cloud_logs_household_key_idx on public.cloud_logs (household_id, key, id desc);

alter table public.cloud_documents enable row level security;
alter table public.cloud_logs enable row level security;
revoke all on public.cloud_documents, public.cloud_logs from anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'homeos_worker') then
    create role homeos_worker nologin;
  end if;
end;
$$;
grant usage on schema public to homeos_worker;
grant select, insert, update, delete on public.cloud_documents, public.cloud_logs to homeos_worker;
grant usage, select on sequence public.cloud_logs_id_seq to homeos_worker;
-- Voor de verwijzing naar het huishouden (bestaat het?).
grant select (id) on public.households to homeos_worker;

create policy cloud_documents_worker on public.cloud_documents for all to homeos_worker using (true) with check (true);
create policy cloud_logs_worker on public.cloud_logs for all to homeos_worker using (true) with check (true);
create policy households_worker_select on public.households for select to homeos_worker using (true);

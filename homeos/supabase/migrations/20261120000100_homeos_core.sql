-- ═══════════════════════════════════════════════════════════════════════════
-- HomeOS — kernschema (fase 2)
-- Alle gebruikersgegevens zijn beveiligd met Row Level Security per huishouden.
-- Apparaatwachtwoorden en integratietokens worden NOOIT in deze database opgeslagen;
-- die blijven versleuteld op de laptop in de Device Connector.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────── hulpfuncties ─────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ───────────────────────────── gebruikers & huishoudens ─────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  timezone text not null default 'Europe/Amsterdam' check (char_length(timezone) <= 64),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'guest')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

-- Lidmaatschapscontroles. SECURITY DEFINER voorkomt recursie in RLS-policies.
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.household_role(hid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.household_members m
  where m.household_id = hid and m.user_id = (select auth.uid());
$$;

-- Rangorde: owner > admin > member > guest
create or replace function public.has_household_role(hid uuid, min_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select array_position(array['guest','member','admin','owner'], m.role)
            >= array_position(array['guest','member','admin','owner'], min_role)
       from public.household_members m
      where m.household_id = hid and m.user_id = (select auth.uid())),
    false);
$$;

create or replace function public.shares_household_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.household_members a
      join public.household_members b on a.household_id = b.household_id
     where a.user_id = (select auth.uid()) and b.user_id = other
  );
$$;

-- ───────────────────────────── kamers & apparaten ─────────────────────────────

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- slug = kamer-ID zoals de Device Connector die gebruikt
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  name text not null check (char_length(trim(name)) between 1 and 60),
  icon text not null default 'door-open' check (char_length(icon) <= 40),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, slug)
);
create index rooms_household_idx on public.rooms (household_id, sort_order);

create table public.device_integrations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  integration_type text not null check (integration_type in ('demo','philips_hue','smart_plug','apple_tv','solar','doorbell')),
  display_name text not null check (char_length(display_name) <= 80),
  connector_id text,
  status text not null default 'UNKNOWN' check (status in ('ONLINE','OFFLINE','CONNECTING','ERROR','UNKNOWN')),
  -- Alleen niet-geheime configuratie (bijv. bridge-ID). Geen tokens of wachtwoorden.
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_integrations_no_secrets check (
    not (config ?| array['token','password','secret','api_key','apikey','application_key','access_token','refresh_token','username'])
  )
);
create index device_integrations_household_idx on public.device_integrations (household_id);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  integration_id uuid references public.device_integrations (id) on delete set null,
  external_id text not null check (char_length(external_id) <= 200),
  name text not null check (char_length(trim(name)) between 1 and 80),
  brand text not null default '',
  model text not null default '',
  kind text not null check (kind in ('light','plug','media','solar_inverter','energy_meter','doorbell','bridge')),
  room_id uuid references public.rooms (id) on delete set null,
  capabilities text[] not null default '{}',
  status text not null default 'UNKNOWN' check (status in ('ONLINE','OFFLINE','CONNECTING','ERROR','UNKNOWN')),
  last_seen timestamptz,
  last_error text,
  demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, external_id)
);
create index devices_household_idx on public.devices (household_id);
create index devices_room_idx on public.devices (room_id);

create table public.device_states (
  device_id uuid primary key references public.devices (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  state_updated_at timestamptz,
  updated_at timestamptz not null default now()
);
create index device_states_household_idx on public.device_states (household_id);

create table public.device_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  device_id uuid references public.devices (id) on delete set null,
  type text not null check (type in ('doorbell_ring','motion','status_change','command','error')),
  message text not null check (char_length(message) <= 500),
  occurred_at timestamptz not null,
  demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index device_events_household_time_idx on public.device_events (household_id, occurred_at desc);

create table public.energy_readings (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  source_id text not null,
  bucket text not null check (bucket in ('15m','hour','day','month')),
  bucket_start timestamptz not null,
  production_kwh numeric(12,3),
  consumption_kwh numeric(12,3),
  import_kwh numeric(12,3),
  export_kwh numeric(12,3),
  demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (household_id, source_id, bucket, bucket_start)
);
create index energy_readings_lookup_idx on public.energy_readings (household_id, bucket, bucket_start desc);

-- ───────────────────────────── automatiseringen & meldingen ─────────────────────────────

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  enabled boolean not null default true,
  definition jsonb not null default '{}'::jsonb check (jsonb_typeof(definition) = 'object'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automations_household_idx on public.automations (household_id);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running','succeeded','failed','skipped','blocked')),
  error text,
  details jsonb not null default '{}'::jsonb
);
create index automation_runs_lookup_idx on public.automation_runs (household_id, started_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- null = voor alle leden van het huishouden
  user_id uuid references public.profiles (id) on delete cascade,
  category text not null check (category in ('connection','energy','maintenance','automation','security','system')),
  title text not null check (char_length(title) <= 120),
  body text not null default '' check (char_length(body) <= 1000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_lookup_idx on public.notifications (household_id, created_at desc);

-- ───────────────────────────── familie ─────────────────────────────

create table public.family_tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 2000),
  assigned_to uuid references public.profiles (id) on delete set null,
  due_date date,
  completed_at timestamptz,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index family_tasks_household_idx on public.family_tasks (household_id, completed_at, due_date);

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  quantity text not null default '' check (char_length(quantity) <= 40),
  checked boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shopping_items_household_idx on public.shopping_items (household_id, checked, created_at);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  location text not null default '' check (char_length(location) <= 200),
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index calendar_events_household_time_idx on public.calendar_events (household_id, starts_at);

create table public.household_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  body text not null default '' check (char_length(body) <= 5000),
  pinned boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index household_notes_household_idx on public.household_notes (household_id, pinned desc, updated_at desc);

create table public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  item_name text not null check (char_length(trim(item_name)) between 1 and 120),
  category text not null default 'overig' check (category in ('apparaat','installatie','verwarming','veiligheid','tuin','overig')),
  brand text not null default '' check (char_length(brand) <= 80),
  model text not null default '' check (char_length(model) <= 120),
  device_id uuid references public.devices (id) on delete set null,
  purchase_date date,
  warranty_until date,
  last_service_at date,
  next_service_at date,
  notes text not null default '' check (char_length(notes) <= 2000),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index maintenance_records_household_idx on public.maintenance_records (household_id, next_service_at);

-- ───────────────────────────── Jarvis ─────────────────────────────

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_conversations_user_idx on public.ai_conversations (user_id, updated_at desc);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null check (char_length(content) <= 8000),
  actions jsonb not null default '[]'::jsonb,
  provider text not null default 'local',
  created_at timestamptz not null default now()
);
create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);

-- ───────────────────────────── audit & connector ─────────────────────────────

create table public.audit_logs (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles (id) on delete set null,
  action text not null check (char_length(action) <= 80),
  source text not null default 'user' check (source in ('user','automation','jarvis','system')),
  target text check (char_length(target) <= 200),
  ok boolean not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_household_time_idx on public.audit_logs (household_id, created_at desc);

create table public.connector_status (
  household_id uuid primary key references public.households (id) on delete cascade,
  -- unieke connectoridentiteit (UUID uit de connector); één connector hoort bij één huishouden
  connector_id text not null unique check (connector_id ~ '^[0-9a-f-]{36}$'),
  version text,
  online boolean not null default false,
  demo_mode boolean not null default false,
  emergency_stop boolean not null default false,
  last_seen_at timestamptz,
  linked_by uuid references public.profiles (id) on delete set null,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────────── updated_at-triggers ─────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['profiles','households','household_members','rooms','device_integrations','devices',
                           'device_states','automations','family_tasks','shopping_items','calendar_events',
                           'household_notes','maintenance_records','ai_conversations','connector_status']
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- ───────────────────────────── nieuw account → profiel ─────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), ''), 80))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────────── RPC's voor huishoudbeheer ─────────────────────────────

-- Maakt een huishouden met de aanroeper als eigenaar en de standaardkamers.
create or replace function public.create_household(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  hid uuid;
begin
  if uid is null then raise exception 'Niet ingelogd' using errcode = '28000'; end if;
  if (select count(*) from public.household_members where user_id = uid and role = 'owner') >= 5 then
    raise exception 'Maximaal 5 eigen huishoudens' using errcode = 'P0001';
  end if;
  insert into public.households (name, created_by) values (trim(p_name), uid) returning id into hid;
  insert into public.household_members (household_id, user_id, role) values (hid, uid, 'owner');
  insert into public.rooms (household_id, slug, name, icon, sort_order) values
    (hid, 'woonkamer', 'Woonkamer', 'sofa', 0),
    (hid, 'keuken', 'Keuken', 'chef-hat', 1),
    (hid, 'slaapkamer', 'Slaapkamer', 'bed', 2),
    (hid, 'badkamer', 'Badkamer', 'bath', 3),
    (hid, 'overig', 'Overige ruimtes', 'door-open', 4);
  insert into public.audit_logs (household_id, user_id, action, ok) values (hid, uid, 'household.create', true);
  return hid;
end;
$$;

-- Voegt een bestaand account toe aan een huishouden (op e-mailadres). Alleen admin/owner.
create or replace function public.add_household_member(p_household uuid, p_email text, p_role text default 'member')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if not public.has_household_role(p_household, 'admin') then
    raise exception 'Geen toestemming' using errcode = '42501';
  end if;
  if p_role not in ('admin','member','guest') then
    raise exception 'Ongeldige rol' using errcode = '22023';
  end if;
  if p_role = 'admin' and not public.has_household_role(p_household, 'owner') then
    raise exception 'Alleen de eigenaar kan beheerders toevoegen' using errcode = '42501';
  end if;
  select u.id into target from auth.users u where lower(u.email) = lower(trim(p_email));
  if target is null then
    raise exception 'Er bestaat nog geen account met dit e-mailadres' using errcode = 'P0002';
  end if;
  insert into public.household_members (household_id, user_id, role) values (p_household, target, p_role)
  on conflict (household_id, user_id) do nothing;
  insert into public.audit_logs (household_id, user_id, action, target, ok, details)
  values (p_household, (select auth.uid()), 'member.add', target::text, true, jsonb_build_object('role', p_role));
  return target;
end;
$$;

create or replace function public.set_household_member_role(p_household uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_role_ text;
begin
  if p_role not in ('owner','admin','member','guest') then
    raise exception 'Ongeldige rol' using errcode = '22023';
  end if;
  select role into current_role_ from public.household_members where household_id = p_household and user_id = p_user;
  if current_role_ is null then raise exception 'Lid niet gevonden' using errcode = 'P0002'; end if;
  -- Owner-rollen wijzigen (geven of afnemen) kan alleen een owner; overige rollen admin of hoger.
  if (p_role in ('owner','admin') or current_role_ in ('owner','admin')) then
    if not public.has_household_role(p_household, 'owner') then
      raise exception 'Alleen de eigenaar kan dit wijzigen' using errcode = '42501';
    end if;
  elsif not public.has_household_role(p_household, 'admin') then
    raise exception 'Geen toestemming' using errcode = '42501';
  end if;
  if current_role_ = 'owner' and p_role <> 'owner'
     and (select count(*) from public.household_members where household_id = p_household and role = 'owner') <= 1 then
    raise exception 'Een huishouden heeft minimaal één eigenaar nodig' using errcode = 'P0001';
  end if;
  update public.household_members set role = p_role where household_id = p_household and user_id = p_user;
  insert into public.audit_logs (household_id, user_id, action, target, ok, details)
  values (p_household, (select auth.uid()), 'member.role', p_user::text, true, jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.remove_household_member(p_household uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  target_role text;
begin
  select role into target_role from public.household_members where household_id = p_household and user_id = p_user;
  if target_role is null then raise exception 'Lid niet gevonden' using errcode = 'P0002'; end if;
  if p_user <> uid then
    if target_role in ('owner','admin') and not public.has_household_role(p_household, 'owner') then
      raise exception 'Alleen de eigenaar kan beheerders verwijderen' using errcode = '42501';
    elsif not public.has_household_role(p_household, 'admin') then
      raise exception 'Geen toestemming' using errcode = '42501';
    end if;
  end if;
  if target_role = 'owner'
     and (select count(*) from public.household_members where household_id = p_household and role = 'owner') <= 1 then
    raise exception 'De laatste eigenaar kan het huishouden niet verlaten' using errcode = 'P0001';
  end if;
  delete from public.household_members where household_id = p_household and user_id = p_user;
  insert into public.audit_logs (household_id, user_id, action, target, ok)
  values (p_household, uid, 'member.remove', p_user::text, true);
end;
$$;

-- Leden met profielnaam en e-mail (alleen voor leden van hetzelfde huishouden).
create or replace function public.household_member_list(p_household uuid)
returns table (user_id uuid, role text, display_name text, email text, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, m.role, p.display_name, u.email::text, m.created_at
    from public.household_members m
    join public.profiles p on p.id = m.user_id
    join auth.users u on u.id = m.user_id
   where m.household_id = p_household
     and public.is_household_member(p_household)
   order by array_position(array['owner','admin','member','guest'], m.role), p.display_name;
$$;

-- ───────────────────────────── Row Level Security ─────────────────────────────

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.rooms enable row level security;
alter table public.device_integrations enable row level security;
alter table public.devices enable row level security;
alter table public.device_states enable row level security;
alter table public.device_events enable row level security;
alter table public.energy_readings enable row level security;
alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;
alter table public.notifications enable row level security;
alter table public.family_tasks enable row level security;
alter table public.shopping_items enable row level security;
alter table public.calendar_events enable row level security;
alter table public.household_notes enable row level security;
alter table public.maintenance_records enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.audit_logs enable row level security;
alter table public.connector_status enable row level security;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_household_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- households (aanmaken alleen via create_household)
create policy households_select on public.households for select to authenticated
  using (public.is_household_member(id));
create policy households_update on public.households for update to authenticated
  using (public.has_household_role(id, 'admin')) with check (public.has_household_role(id, 'admin'));
create policy households_delete on public.households for delete to authenticated
  using (public.has_household_role(id, 'owner'));

-- household_members (wijzigen alleen via RPC's)
create policy household_members_select on public.household_members for select to authenticated
  using (public.is_household_member(household_id));

-- Tabellen: lezen voor alle leden, schrijven voor admin+
do $$
declare t text;
begin
  foreach t in array array['rooms','device_integrations','devices','device_states','device_events',
                           'energy_readings','automations','automation_runs','connector_status']
  loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.is_household_member(household_id))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.has_household_role(household_id, ''admin''))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.has_household_role(household_id, ''admin'')) with check (public.has_household_role(household_id, ''admin''))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (public.has_household_role(household_id, ''admin''))', t);
  end loop;
end;
$$;

-- Familiegegevens: lezen voor alle leden (ook gasten), schrijven voor leden (niet gasten)
do $$
declare t text;
begin
  foreach t in array array['family_tasks','shopping_items','calendar_events','household_notes','maintenance_records']
  loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.is_household_member(household_id))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.has_household_role(household_id, ''member'') and created_by = (select auth.uid()))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.has_household_role(household_id, ''member'')) with check (public.has_household_role(household_id, ''member''))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (public.has_household_role(household_id, ''member''))', t);
  end loop;
end;
$$;

-- Taken mogen alleen worden toegewezen aan leden van hetzelfde huishouden
create or replace function public.check_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is not null and not exists (
    select 1 from public.household_members where household_id = new.household_id and user_id = new.assigned_to
  ) then
    raise exception 'Taak kan alleen aan een lid van het huishouden worden toegewezen' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger family_tasks_assignee before insert or update on public.family_tasks
  for each row execute function public.check_task_assignee();

-- notifications: eigen of huishoudbrede meldingen
create policy notifications_select on public.notifications for select to authenticated
  using (public.is_household_member(household_id) and (user_id is null or user_id = (select auth.uid())));
create policy notifications_insert on public.notifications for insert to authenticated
  with check (public.has_household_role(household_id, 'admin'));
create policy notifications_update on public.notifications for update to authenticated
  using (public.is_household_member(household_id) and user_id = (select auth.uid()))
  with check (public.is_household_member(household_id) and user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (public.is_household_member(household_id) and (user_id = (select auth.uid()) or public.has_household_role(household_id, 'admin')));

-- Jarvis-gesprekken zijn privé per gebruiker
create policy ai_conversations_all on public.ai_conversations for all to authenticated
  using (user_id = (select auth.uid()) and public.is_household_member(household_id))
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));
create policy ai_messages_all on public.ai_messages for all to authenticated
  using (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.ai_conversations c
                      where c.id = conversation_id and c.user_id = (select auth.uid()) and c.household_id = ai_messages.household_id));

-- audit_logs: alleen toevoegen (als jezelf), lezen voor admin+, nooit wijzigen of verwijderen
create policy audit_logs_insert on public.audit_logs for insert to authenticated
  with check (public.is_household_member(household_id) and user_id = (select auth.uid()));
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.has_household_role(household_id, 'admin'));

-- ───────────────────────────── rechten ─────────────────────────────

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.create_household(text), public.add_household_member(uuid, text, text),
  public.set_household_member_role(uuid, uuid, text), public.remove_household_member(uuid, uuid),
  public.household_member_list(uuid), public.is_household_member(uuid), public.household_role(uuid),
  public.has_household_role(uuid, text), public.shares_household_with(uuid) to authenticated;
-- audit_logs is append-only, ook voor de eigenaar
revoke update, delete on public.audit_logs from authenticated;

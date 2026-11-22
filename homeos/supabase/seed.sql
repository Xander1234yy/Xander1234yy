-- ═══════════════════════════════════════════════════════════════════════════
-- HomeOS seed: ALLEEN voor een lokale ontwikkel-database (`supabase start` / `supabase db reset`).
-- Alle gegevens zijn DEMO. Draai dit nooit op productie.
-- Demo-account: demo@homeos.local / homeos-demo-wachtwoord
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  demo_uid uuid := '11111111-1111-4111-8111-111111111111';
  hid uuid;
begin
  if exists (select 1 from auth.users where email = 'demo@homeos.local') then
    raise notice 'Demo-account bestaat al, seed overgeslagen';
    return;
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', demo_uid, 'authenticated', 'authenticated', 'demo@homeos.local',
          extensions.crypt('homeos-demo-wachtwoord', extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{"display_name":"Demo (DEMO)"}', now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), demo_uid, demo_uid::text,
          jsonb_build_object('sub', demo_uid::text, 'email', 'demo@homeos.local', 'email_verified', true),
          'email', now(), now(), now());

  perform set_config('request.jwt.claim.sub', demo_uid::text, true);
  hid := public.create_household('Demohuis (DEMO)');

  insert into public.shopping_items (household_id, name, quantity, created_by) values
    (hid, 'Melk (DEMO)', '2 pakken', demo_uid),
    (hid, 'Brood (DEMO)', '1', demo_uid),
    (hid, 'Koffiebonen (DEMO)', '500 g', demo_uid);

  insert into public.family_tasks (household_id, title, due_date, created_by) values
    (hid, 'Vuilnisbak aan de straat (DEMO)', current_date + 1, demo_uid),
    (hid, 'Planten water geven (DEMO)', current_date + 3, demo_uid);

  insert into public.calendar_events (household_id, title, starts_at, ends_at, location, created_by) values
    (hid, 'Tandarts (DEMO)', date_trunc('day', now()) + interval '2 days 9 hours', date_trunc('day', now()) + interval '2 days 10 hours', 'Centrum', demo_uid),
    (hid, 'Verjaardag oma (DEMO)', date_trunc('day', now()) + interval '6 days', null, '', demo_uid);

  insert into public.household_notes (household_id, title, body, pinned, created_by) values
    (hid, 'Wifi-gasten (DEMO)', 'Netwerk: Demo-Gast. Wachtwoord staat op de router.', true, demo_uid);

  insert into public.maintenance_records (household_id, item_name, category, brand, purchase_date, warranty_until, last_service_at, next_service_at, created_by) values
    (hid, 'Cv-ketel (DEMO)', 'verwarming', 'Demo', current_date - 900, current_date + 900, current_date - 300, current_date + 65, demo_uid),
    (hid, 'Rookmelders (DEMO)', 'veiligheid', 'Demo', current_date - 400, null, current_date - 360, current_date + 5, demo_uid);
end;
$$;

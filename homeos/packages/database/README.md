# @homeos/database — fase 2

Supabase-client, gegenereerde types en repository-functies. Migraties staan in `supabase/migrations/`.

Tabellen (fase 2): profiles, households, household_members, rooms, devices, device_integrations,
device_states, device_events, energy_readings, automations, automation_runs, notifications, family_tasks,
shopping_items, calendar_events, maintenance_records, ai_conversations, ai_messages, audit_logs, connector_status.

Regels: UUID's, foreign keys, indexen, timestamps, RLS op alle gebruikersgegevens, en **nooit**
apparaatwachtwoorden of integratietokens in de database — die blijven versleuteld op de laptop (connector).

-- Fase 8: indexen op foreign keys (Supabase performance-advies 0001). Versnelt joins en voorkomt volledige scans bij
-- het verwijderen van gebruikers, apparaten of automatiseringen. Geen gedragswijziging.
create index if not exists ai_conversations_household_id_idx on public.ai_conversations (household_id);
create index if not exists ai_messages_household_id_idx on public.ai_messages (household_id);
create index if not exists audit_logs_user_id_idx on public.audit_logs (user_id);
create index if not exists automation_runs_automation_id_idx on public.automation_runs (automation_id);
create index if not exists automations_created_by_idx on public.automations (created_by);
create index if not exists calendar_events_created_by_idx on public.calendar_events (created_by);
create index if not exists connector_status_linked_by_idx on public.connector_status (linked_by);
create index if not exists device_events_device_id_idx on public.device_events (device_id);
create index if not exists devices_integration_id_idx on public.devices (integration_id);
create index if not exists family_tasks_assigned_to_idx on public.family_tasks (assigned_to);
create index if not exists family_tasks_created_by_idx on public.family_tasks (created_by);
create index if not exists household_notes_created_by_idx on public.household_notes (created_by);
create index if not exists households_created_by_idx on public.households (created_by);
create index if not exists maintenance_records_created_by_idx on public.maintenance_records (created_by);
create index if not exists maintenance_records_device_id_idx on public.maintenance_records (device_id);
create index if not exists notifications_user_id_idx on public.notifications (user_id);
create index if not exists shopping_items_created_by_idx on public.shopping_items (created_by);

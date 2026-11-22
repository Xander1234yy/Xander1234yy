-- Fase 4: airco/klimaat als apparaattype en integratietype.
alter table public.devices drop constraint if exists devices_kind_check;
alter table public.devices add constraint devices_kind_check
  check (kind in ('light','plug','media','solar_inverter','energy_meter','doorbell','bridge','climate'));

alter table public.device_integrations drop constraint if exists device_integrations_integration_type_check;
alter table public.device_integrations add constraint device_integrations_integration_type_check
  check (integration_type in ('demo','philips_hue','smart_plug','apple_tv','solar','doorbell','climate'));

-- Verversingsinterval van de bron (cloud-API's met daglimiet), voor eerlijke versheidsweergave.
alter table public.devices add column if not exists refresh_interval_ms integer check (refresh_interval_ms is null or refresh_interval_ms > 0);

-- Camera's (Tapo via ONVIF/RTSP) als apparaattype en integratietype. Beelden en camera-accounts komen nooit in de database.
alter table public.devices drop constraint if exists devices_kind_check;
alter table public.devices add constraint devices_kind_check
  check (kind in ('light','plug','media','solar_inverter','energy_meter','doorbell','bridge','climate','camera'));

alter table public.device_integrations drop constraint if exists device_integrations_integration_type_check;
alter table public.device_integrations add constraint device_integrations_integration_type_check
  check (integration_type in ('demo','philips_hue','smart_plug','apple_tv','solar','doorbell','climate','lg_webos','tapo_camera'));

-- Zonneplan Connect (niet-officiële koppeling, op verzoek van de gebruiker) als integratietype. Tokens nooit in de database.
alter table public.device_integrations drop constraint if exists device_integrations_integration_type_check;
alter table public.device_integrations add constraint device_integrations_integration_type_check
  check (integration_type in ('demo','philips_hue','smart_plug','apple_tv','solar','doorbell','climate','lg_webos','tapo_camera','zonneplan'));

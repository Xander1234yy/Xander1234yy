-- LG webOS-tv als integratietype. De client-key van de tv staat nooit in de database (alleen versleuteld in de connector).
alter table public.device_integrations drop constraint if exists device_integrations_integration_type_check;
alter table public.device_integrations add constraint device_integrations_integration_type_check
  check (integration_type in ('demo','philips_hue','smart_plug','apple_tv','solar','doorbell','climate','lg_webos'));

-- Ook tv-sleutels (client-key) en andere sleutelvarianten weigeren in de niet-geheime configuratie.
alter table public.device_integrations drop constraint if exists device_integrations_no_secrets;
alter table public.device_integrations add constraint device_integrations_no_secrets check (
  not (config ?| array['token','password','secret','api_key','apikey','application_key','access_token','refresh_token','username',
                       'client_key','clientkey','client-key','client_secret','app_key','appkey','private_key'])
);

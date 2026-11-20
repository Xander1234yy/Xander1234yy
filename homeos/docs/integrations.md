# Integraties

Iedere integratie implementeert `DeviceAdapter` (`packages/integrations/src/adapter.ts`):
`connect`, `disconnect`, `discover`, `getStatus`, `executeCommand`, `getCapabilities` en `healthCheck`, plus optioneel
`getScenes`/`activateScene` en `energy`. Adapters draaien uitsluitend in de connector.

**Regel:** alleen officiële, gedocumenteerde en toegestane koppelingen. Is een apparaat niet compatibel, dan geeft de
adapter de status `not_configured` of een fout met uitleg en een alternatief. Er wordt nooit een geslaagde verbinding verzonnen.

## Huidige adapters (fase 1)

| Adapter | Type | Opmerking |
| --- | --- | --- |
| `demo-lights` | DEMO | 6 lampen (waarvan 1 bewust offline), 4 scènes |
| `demo-plugs` | DEMO | 3 stekkers met energiemeting |
| `demo-media` | DEMO | Mediaspeler die het gedrag van een Apple TV nabootst |
| `demo-energy` | DEMO | Deterministisch zonne- en verbruiksmodel (omvormer en P1-meter) |
| `demo-doorbell` | DEMO | Belmeldingen en beweging, geen beelden |

DEMO-adapters worden alleen geladen als `HOMEOS_DEMO=true` (standaard in ontwikkeling, uit in productie).

## Philips Hue (fase 3 — gebouwd)

`packages/integrations/src/hue/` gebruikt uitsluitend de officiële lokale Hue Bridge API:

| Onderdeel | Implementatie |
| --- | --- |
| Zoeken | Officiële discoverydienst (`discovery.meethue.com`, gecachet 15 min.) of handmatig IP-adres |
| Koppelen | Link-knop + `POST /api` met `generateclientkey`; controle via `/api/0/config` (bridge-ID, model BSB*) |
| Beveiliging | Alleen privé-LAN-adressen; certificaat-pinning (SHA-256, vastgelegd bij koppelen); Common Name moet de bridge-ID zijn; key versleuteld in de SecretStore |
| Lampen | CLIP v2 `light`, `device`, `room`, `zigbee_connectivity`; capabilities per lamp (dimbaar, kleur, kleurtemperatuur) |
| Status | Eventstream (`/eventstream/clip/v2`) plus volledige verversing elke 10 s; onbereikbare lampen → OFFLINE |
| Opdrachten | Aan/uit, helderheid, kleur (sRGB → CIE xy binnen het gamut van de lamp), kleurtemperatuur (mirek, binnen het bereik van de lamp); max. ~10 per seconde; de werkelijke status wordt na iedere opdracht teruggelezen |
| Scènes | Kamerscènes activeren via `recall: { action: "active" }` |
| Kamers | Hue-kamers worden gekoppeld aan HomeOS-kamers met dezelfde naam |

Getest met unit-tests (nep-transport), een echte HTTPS-server voor de pinning, en end-to-end tegen
`tests/tools/hue-bridge-simulator.mjs` (een **simulator**, geen echt apparaat). Met een echte bridge is nog niet getest:
dat doe jij als eerste. Bij problemen staat het logboek in `~/Library/Logs/HomeOS/connector.log`.

## Fase 4: jouw apparaten en wat officieel kan

### Slimme stekkers — Smart Life / Tuya ✅ mogelijk (via de cloud)
- Officiële route: de **Tuya Cloud OpenAPI** via een (gratis) project op het Tuya IoT Development Platform. Je Smart Life-account
  koppel je door een QR-code te scannen in de Smart Life-app. Daarna kan HomeOS status, aan/uit en (als de stekker dat
  ondersteunt) het actuele vermogen uitlezen.
- Kanttekeningen: opdrachten lopen via de Tuya-cloud (niet lokaal). Het gratis "IoT Core"-proefabonnement moet volgens
  gebruikersmeldingen periodiek verlengd worden in de Tuya-console. De lokale Tuya-protocollen zijn niet officieel
  gedocumenteerd en worden daarom niet gebruikt.
- Credentials (Access ID/Secret) komen versleuteld in de connector, nooit in Supabase.

### Zonnepanelen — SolarEdge ✅ mogelijk
- Officiële **SolarEdge Monitoring API** (v1) met een site-API-key (Monitoring-portal → Admin → Site Access; soms moet de
  installateur die activeren). Limiet: **300 verzoeken per dag per site**, dus HomeOS ververst de actuele opwek ongeveer
  elke 6 minuten en de dag-, maand- en jaartotalen minder vaak.
- Netafname en teruglevering zijn alleen beschikbaar als er een SolarEdge-energiemeter is geïnstalleerd; zonder meter toont
  HomeOS die velden als "niet beschikbaar" (nooit geschat).
- Alternatief later: lokale Modbus TCP (door SolarEdge gedocumenteerd), zonder daglimiet.

### Deurbel — Tapo ⚠️ beperkt
- TP-Link biedt **geen officiële API voor belmeldingen** van Tapo-deurbellen. Via ONVIF Profile S/RTSP kan alleen het
  videobeeld, en volgens TP-Link alleen bij de **D235/D225** als ze bedraad zijn en "always-on" aan staat. De **D230**
  (batterij, via hub H200) ondersteunt dit officieel niet.
- Daarom: geen belmeldingen in HomeOS (nog niet), wel eventueel een live beeld (privé, nooit openbaar) als je model het
  officieel ondersteunt. **Nodig van jou: het exacte model.**

### Apple TV
- Geen officiële API voor lokale bediening door derden; dit blijft onderzoek. Er wordt geen onbewezen protocol gebruikt.

Bronnen: [Tuya-koppeling (Home Assistant-community)](https://community.home-assistant.io/t/tuya-dev-account-renewal-steps/685268),
[SolarEdge API-limiet (Home Assistant-docs)](https://www.home-assistant.io/integrations/solaredge),
[TP-Link FAQ RTSP/ONVIF](https://tp-link.com/support/faq/2680), [Tapo D235-belgebeurtenissen (TP-Link-community)](https://community.tp-link.com/en/home/forum/topic/736506).
De officiële documentatie van Tuya en SolarEdge wordt aan het begin van fase 4 opnieuw gecontroleerd.

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
| `demo-media` | DEMO | Mediaspeler/tv met volume en ingangen (gesimuleerd) |
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

Getest met unit-tests (nep-transport), een echte HTTPS-server voor de pinning, end-to-end tegen
`tests/tools/hue-bridge-simulator.mjs` (een **simulator**), én in de praktijk gekoppeld met een echte Hue Bridge
(9 lampen, 20 november 2026). Bij problemen staat het logboek in `~/Library/Logs/HomeOS/connector.log`.

## Fase 4: jouw apparaten en wat officieel kan

### Slimme stekkers — Smart Life / Tuya ✅ gebouwd (fase 4b)

Gebouwd in `packages/integrations/src/tuya/` op de officiële Tuya Cloud OpenAPI. Ondertekening (HMAC-SHA256),
token (`/v1.0/token?grant_type=1`), apparatenlijst van het gekoppelde app-account (`/v1.0/users/{uid}/devices`),
specificaties (`/v1.0/devices/{id}/specifications`) en opdrachten (`/v1.0/devices/{id}/commands`) zijn gecontroleerd in
Tuya's eigen SDK's (`@tuya/tuya-connector-nodejs`, `tuya-iot-py-sdk`); de handtekening is getest tegen een referentie
berekend volgens de Python-SDK.

- Koppelen in Instellingen: datacenter, Access ID + Access Secret (Tuya-console → Cloud-project) en de UID van het
  gekoppelde Smart Life-account (Devices → Link App Account).
- Ondersteund: stekkers en schakelaars (categorieën `cz`, `pc`, `kg`): aan/uit en, als de stekker het meldt, actueel
  vermogen (schaal uit de specificatie). Andere Tuya-apparaten worden overgeslagen en in de status genoemd.
- Verversen elke 2 minuten (één verzoek voor alle apparaten); na een opdracht wordt de status direct teruggelezen.
- Een verlopen IoT Core-abonnement of quotum wordt als duidelijke melding getoond.
- Getest met een nagebootste Tuya-cloud die handtekeningen echt controleert, én in de praktijk gekoppeld met een echt
  Smart Life-account via een Tuya Cloud-project (Central Europe), 20 november 2026.

#### Achtergrond
- Officiële route: de **Tuya Cloud OpenAPI** via een (gratis) project op het Tuya IoT Development Platform. Je Smart Life-account
  koppel je door een QR-code te scannen in de Smart Life-app. Daarna kan HomeOS status, aan/uit en (als de stekker dat
  ondersteunt) het actuele vermogen uitlezen.
- Kanttekeningen: opdrachten lopen via de Tuya-cloud (niet lokaal). Het gratis "IoT Core"-proefabonnement moet volgens
  gebruikersmeldingen periodiek verlengd worden in de Tuya-console. De lokale Tuya-protocollen zijn niet officieel
  gedocumenteerd en worden daarom niet gebruikt.
- Credentials (Access ID/Secret) komen versleuteld in de connector, nooit in Supabase.

### Zonnepanelen — SolarEdge ✅ gebouwd (fase 4a)

Gebouwd in `packages/integrations/src/solaredge/`: koppelen met site-ID + API-key (gevalideerd via `/site/{id}/details`),
actuele opwek en dag/maand/jaar uit `/site/{id}/overview`, historie uit `/site/{id}/energy` (kwartier/dag/maand,
tijden omgerekend vanuit de tijdzone van de site), verzoekbudget van 280/dag met vaste ververs-momenten en caching.
Zonder meter (jouw situatie) blijven verbruik, afname en teruglevering `null` en toont de UI "niet gemeten".
Getest met nagebootste API-antwoorden; nog niet tegen jouw echte installatie.

#### Achtergrond
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
  officieel ondersteunt.
- **Jouw situatie: Tapo D235 op batterij (bevestigd: blijft op batterij).** In deze opstelling is er geen officiële koppeling: RTSP/ONVIF werkt bij de D235
  alleen bedraad (met jumperkabel en "always-on"). HomeOS toont de deurbel daarom als "niet ondersteund in deze opstelling",
  met uitleg. Wordt hij later bedraad, dan kan HomeOS het live beeld tonen; belmeldingen blijven ook dan officieel
  onbeschikbaar. De DEMO-deurbel blijft beschikbaar om de interface te testen.

### Tapo-camera's (C500) ✅ gebouwd — getest met een nagebootste camera en echte ffmpeg, nog niet met jouw C500
- **Route:** TP-Link's officiële koppeling voor recorders van derden: ONVIF Profile S (poort 2020) en RTSP (poort 554,
  `stream1` hoog / `stream2` laag) met een apart **camera-account** uit de Tapo-app. Alleen camera's op netstroom.
- **Wat HomeOS doet:** status (ONVIF), bewegings- en persoonsmeldingen (ONVIF PullPoint; meldingen max. eens per 5 min per
  camera, categorie Beveiliging), draaien/kantelen (ONVIF PTZ, alleen handmatig), momentopname en live beeld.
- **Beeld:** ffmpeg op de laptop zet `stream2` om naar MJPEG (5 beelden/s). Eén ffmpeg-proces per camera, gedeeld door
  kijkers, stopt na 10 s zonder kijkers of na 15 min. ffmpeg: `brew install ffmpeg` (of `HOMEOS_FFMPEG_PATH`).
- **Privacy:** beelden gaan camera → connector → ingelogde webapp, nooit via een cloud, en worden niet opgeslagen.
  Alleen leden en hoger (`view_cameras`), geen gasten. Iedere live-weergave in de auditlog. Jarvis en automatiseringen
  kunnen camera's niet bedienen (`SAFETY_CRITICAL_KINDS`); Jarvis kan wel vertellen wanneer er beweging was.
- **Beperkingen:** ONVIF en RTSP op Tapo zijn niet versleuteld (HTTP/RTSP op je eigen netwerk). Het ONVIF-wachtwoord gaat
  als digest, RTSP met digest-authenticatie. Het RTSP-adres met wachtwoord staat in de ffmpeg-opdrachtregel en is dus
  zichtbaar voor andere gebruikers op dezelfde Mac (`ps`). Tapo staat max. twee van: Tapo Care, SD-kaart, ONVIF/RTSP toe;
  met alleen een SD-kaart is dat geen probleem.

### IKEA Home smart ✅ via Matter (met beperkingen)
- IKEA heeft **geen officiële publieke API** voor de DIRIGERA-hub. Bestaande integraties gebruiken een
  reverse-engineered API; die gebruikt HomeOS niet.
- De officiële route is **Matter**: de DIRIGERA-hub is Matter-gecertificeerd en kan als *Matter-bridge* IKEA-apparaten
  delen met andere systemen. HomeOS wordt daarvoor zelf een Matter-controller op basis van het open-source
  **matter.js**-project (project-chip). Koppelen gebeurt met de Matter-koppelcode uit de IKEA Home smart-app
  (multi-admin), via je lokale netwerk, zonder cloud.
- Beperking volgens IKEA: via de Matter-bridge worden **op dit moment alleen lichtbronnen (incl. drivers)** gedeeld.
  IKEA-stekkers, sensoren, schakelaars en rolgordijnen zijn via de officiële route dus (nog) niet beschikbaar.
- De oude **TRÅDFRI-gateway** heeft geen officiële API en geen Matter: niet ondersteund (alternatief: DIRIGERA).
- **Gebouwd (fase 4b, experimenteel):** HomeOS is een Matter-controller op basis van **matter.js 0.18.0**
  (`apps/connector/src/matter-backend.ts`, alleen geladen als je Matter gebruikt). Koppelen met de deelcode uit de
  IKEA-app ("Bediening in andere systemen"); stekkers (aan/uit, vermogen via ElectricalPowerMeasurement) en lampen
  (aan/uit, helderheid), ook achter een Matter-bridge. Fabric-sleutels staan in `<datamap>/matter` (rechten 0700).
  Ontkoppelen verwijdert alleen de HomeOS-fabric; de IKEA-koppeling blijft.
- **Getest:** de adapterlogica met een nagebootste Matter-laag, en dat de connector niet crasht als de Matter-stack niet
  kan starten. **Niet getest:** echt koppelen; de ontwikkelomgeving heeft geen IPv6 (verplicht voor Matter). Dat test
  jij als eerste op je Mac. Gebruikers melden dat IKEA-deelcodes niet altijd in één keer werken.
- **Jouw situatie: DIRIGERA + GRILLPLATS.** De nieuwe GRILLPLATS is zelf een Matter-over-Thread-stekker (met
  energiemeting) en gebruikt de DIRIGERA als Thread-border-router. Een Matter-apparaat kan met meerdere systemen
  tegelijk gekoppeld worden (multi-admin), dus HomeOS kan de stekker als Matter-controller rechtstreeks koppelen met
  een koppelcode uit de IKEA-app, los van de Matter-bridge-beperking. Dit wordt gebouwd in fase 4b, samen met Tuya.

### Airco — Daikin Onecta ✅ gebouwd (fase 4a)

Gebouwd in `packages/integrations/src/daikin/` op basis van de officiële endpoints (geverifieerd in de broncode van de
open-source client `daikin-controller-cloud`): OIDC `https://idp.onecta.daikineurope.com/v1/oidc/{authorize,token}`,
scope `openid onecta:basic.integration`, API `https://api.onecta.daikineurope.com/v1/gateway-devices` en
`PATCH …/management-points/{embeddedId}/characteristics/{naam}` met `{ value, path }`.

- Koppelen in Instellingen: client-ID/secret uit het Daikin Developer Portal, inloggen bij Daikin, daarna de
  terugkeer-URL plakken (of automatisch via `/integraties/daikin` als HomeOS op https draait). De state wordt
  gecontroleerd; secret en tokens staan versleuteld in de connector; tokens worden automatisch vernieuwd.
- **Daikin accepteert geen `localhost`/`127.0.0.1` als redirect-URI en vereist https.** Standaard stelt HomeOS
  `https://homeos.invalid/daikin-callback` voor: dat domein bestaat nooit, dus de code blijft in je browser.
  Weigert het portal dit adres, gebruik dan een https-adres dat van jou is.
- Bediening: aan/uit, modus, gewenste temperatuur (binnen min/max/stap van de unit); kamer- en buitentemperatuur.
- 200 verzoeken/dag: één verzoek per 10 minuten voor alle units, 40 gereserveerd voor opdrachten,
  `x-ratelimit-remaining-day` en `retry-after` worden gevolgd. Na een opdracht wordt na 90 s ter controle opnieuw gelezen
  (de Daikin-cloud kan direct na een wijziging nog de oude waarde geven).
- Getest met nagebootste API-antwoorden én in de praktijk gekoppeld met een echt Onecta-account (20 november 2026),
  inclusief de `homeos.invalid`-redirect in het Daikin Developer Portal.

#### Achtergrond
- Officiële **Daikin Onecta Cloud API** via het Daikin Developer Portal (gratis voor privé-ontwikkelaars). Koppelen met
  OAuth2: je logt één keer in met je Daikin-account en HomeOS krijgt een token. Dat token wordt versleuteld in de
  connector bewaard en nooit in Supabase.
- Limiet volgens Daikin: **200 verzoeken per dag per gebruiker** (sliding window), maximaal 20 per minuut. HomeOS leest
  de status daarom ongeveer elke 10 minuten (± 145 per dag) en houdt de rest vrij voor opdrachten. Blijft het budget
  op, dan meldt HomeOS dat eerlijk in plaats van oude waarden als live te tonen.
- Verwachte functies (afhankelijk van wat de unit via de API meldt): aan/uit, modus (koelen, verwarmen, ventileren,
  drogen, auto), gewenste temperatuur, ventilatorstand, kamer- en buitentemperatuur. Hiervoor komen nieuwe
  capabilities (`climate`) en opdrachten in `@homeos/shared`.
- Opdrachten lopen via de Daikin-cloud (niet lokaal). De unit moet in de Onecta-app staan (wifi-adapter verbonden).
- Te controleren bij de bouw: welke redirect-URL's het portal toestaat voor een lokaal draaiende app.

### LG-tv (webOS) ✅ gebouwd — getest met een nagebootste tv, nog niet met jouw OLED48CX6LB
- **Route:** het lokale "second screen"-protocol (SSAP) van webOS over een WebSocket. Dit is het protocol van LG's eigen
  open-source Connect SDK en de LG-afstandsbedieningsapp; HomeOS gebruikt het registratiemanifest van de Connect SDK
  ("LG Remote App", vendor `com.lge`). De officiële ThinQ Connect API ondersteunt geen tv's, dus die is niet bruikbaar.
- **Verbinding:** `wss://<ip>:3001` met het zelfondertekende certificaat van de tv. HomeOS pint de vingerafdruk bij het
  koppelen (zoals bij Hue) en stuurt de client-key pas na controle. Alleen privé-IP-adressen.
- **Koppelen:** Instellingen → LG-tv. De tv toont een melding; de gebruiker kiest Toestaan. De client-key staat versleuteld
  in de SecretStore. Vindt hij de tv niet automatisch (SSDP), vul dan het IP-adres in.
- **Bediening:** aan (Wake-on-LAN), uit, volume (instellen, harder/zachter), dempen, ingang (HDMI) of app kiezen,
  afspelen/pauzeren. Vorige/volgende zit niet in de tv-API en wordt dus niet getoond.
- **Aanzetten:** een tv die uit staat is onbereikbaar. HomeOS stuurt dan een Wake-on-LAN-pakket naar het MAC-adres dat
  bij het koppelen is uitgelezen (of handmatig ingevuld). Op de tv moet "Inschakelen via Wi-Fi" aan staan. HomeOS doet
  niet alsof de tv al aan is: de status wordt pas "aan" als de tv zelf reageert.
- **Tv-instellingen (CX, webOS 5):** Instellingen → Algemeen → Mobiele tv aan → "Inschakelen via Wi-Fi" aan; en
  "LG Connect Apps" aan (Instellingen → Netwerk of Algemeen, afhankelijk van de firmware).
- **Beperkingen:** de afspeelstatus (spelen/pauze) meldt de tv niet betrouwbaar en wordt als onbekend getoond. Het
  protocol is niet als openbare API gedocumenteerd door LG; een firmware-update kan het gedrag veranderen. Nieuwere
  firmware die het ondertekende manifest weigert wordt opgevangen met een manifest zonder handtekening.

### Apple TV ❌ niet ondersteund (onderzocht in fase 4b)
- Apple biedt geen officiële, gedocumenteerde API voor lokale bediening van een Apple TV door derden. Bestaande
  projecten (zoals pyatv) gebruiken reverse-engineered protocollen (MRP/Companion/AirPlay-varianten); die vallen onder
  "onbewezen protocollen" en gebruikt HomeOS bewust niet. HomeKit en Matter bieden geen bediening van de Apple TV zelf
  (de Apple TV is daar een hub, geen bedienbaar apparaat).
- HomeOS toont de Apple TV daarom niet als koppelbaar apparaat; de Entertainment-pagina blijft werken met de
  DEMO-mediaspeler. Komt er een officiële route, dan is de mediaspeler-capability er al klaar voor.

Bronnen: [Tuya-koppeling (Home Assistant-community)](https://community.home-assistant.io/t/tuya-dev-account-renewal-steps/685268),
[SolarEdge API-limiet (Home Assistant-docs)](https://www.home-assistant.io/integrations/solaredge),
[TP-Link FAQ RTSP/ONVIF](https://tp-link.com/support/faq/2680), [Tapo D235-belgebeurtenissen (TP-Link-community)](https://community.tp-link.com/en/home/forum/topic/736506),
[IKEA: wat is de Matter-bridge](https://www.ikea.com/gb/en/customer-service/knowledge/articles/cdbc4637-5d63-4893-b382-20987cafecc4.html),
[IKEA-nieuwsbericht DIRIGERA Matter-bridge](https://www.ikea.com/global/en/newsroom/innovation/ikea-dirigera-matter-bridge-240911),
[matter.js](https://github.com/project-chip/matter.js),
[Daikin Developer Portal](https://www.daikin.eu/en_us/product-group/control-systems/daikin-developer-portal.html).
De officiële documentatie van Tuya en SolarEdge wordt aan het begin van fase 4 opnieuw gecontroleerd.

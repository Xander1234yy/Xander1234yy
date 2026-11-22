# Roadmap en implementatieplan

| Fase | Inhoud | Status |
| --- | --- | --- |
| 1 | Architectuur, monorepo, design system, dashboard, DEMO-apparaten, lokale dev-omgeving | ✅ Klaar |
| 2 | Supabase: schema en migraties (alle 20 tabellen), RLS, Auth, huishoudens, kamers naar de database, familie en onderhoud | ✅ Klaar |
| 3 | Philips Hue-adapter, pairing, apparaatregistry naar Supabase (devices/device_states), macOS-autostart | ✅ Klaar |
| 4 | Stekkers, Apple TV (onderzoek), zonnepanelen, deurbel | |
| 5 | Automation Engine, notificaties, geschiedenis | ✅ Klaar |
| 6 | Jarvis: lokaal en gratis, provider-interface, spraak, opdrachtverwerking, geschiedenis | ✅ Klaar |
| 7 | PWA (installeerbaar, service worker, offline, iOS-iconen), pushmeldingen, veilige toegang via Tailscale | ✅ Klaar |
| 8 | Beveiligingsaudit, volledige tests, documentatie, optimalisatie | ⏭ Volgende |

## Fase 1: opgeleverd

- npm-workspaces-monorepo met strikte TypeScript, ESLint, Vitest en Playwright.
- `@homeos/shared`: domeinmodel (apparaten, statussen, capabilities, opdrachten, energie, protocol), zod-validatie,
  `checkCommand()`, versheidsregels, kostenberekening.
- `@homeos/integrations`: adapterinterface en 5 DEMO-adapters.
- Device Connector: registry, persistente configuratie, identiteit en token, versleutelde secrets, REST- en WebSocket-API,
  rate limiting, auditlog, gebeurtenissenlog, noodstop.
- Webapp: premium donker dashboard met 10 functionele kaarten en de pagina's Kamers (beheer), Apparaten (zoeken,
  toevoegen, hernoemen, verplaatsen, verwijderen, synchroniseren), Energie (grafieken, kosten, inzichten), Entertainment,
  Beveiliging, Jarvis (lokale fallback, spraakinvoer, voorlezen, bevestiging, geschiedenis) en Instellingen
  (connector, integraties, noodstop, auditlog). Automatiseringen, Familie en Onderhoud tonen eerlijk hun geplande fase.
- Offline-gedrag: cloud en connector apart weergegeven, laatst bekende gegevens nooit als live.
- Tests: 52 unit- en integratietests en 21 E2E-tests (desktop, iPhone, iPad).

## Fase 2: opgeleverd

- Supabase-schema met 21 tabellen (de 20 uit de spec plus `household_notes` voor gedeelde notities), foreign keys,
  indexen, `updated_at`-triggers, CHECK-validatie en RLS op iedere tabel. Migratiescript `npm run db:migrate`.
- Rollen (eigenaar, beheerder, lid, gast), afgedwongen op drie lagen: RLS in de database, server actions en
  API-routes (`can()`), en de UI (bediening uitgeschakeld).
- Supabase Auth: registreren, inloggen, uitloggen, wachtwoord vergeten/wijzigen, e-mailbevestiging (`/auth/confirm`).
  Sessies staan in httpOnly-cookies; de browser praat nooit rechtstreeks met Supabase.
- `proxy.ts` beschermt alle pagina's en API's. Onboarding maakt een huishouden met standaardkamers. Gebruikers kunnen
  tussen huishoudens wisselen.
- Connectorkoppeling per huishouden: een huishouden kan alleen zijn eigen connector gebruiken.
- Kamers in Supabase, automatisch gesynchroniseerd naar de connector.
- Familie (agenda, taken met toewijzing en deadline, boodschappen, notities), Onderhoud (garantie, onderhoudsdata,
  herinneringen), Instellingen (gebruikers, rollen, huishouden, connector) en Mijn account.
- Jarvis kent de boodschappenlijst, agenda en taken, en kan na bevestiging een boodschap toevoegen.
- Auditlog in Supabase voor alle connectoracties via de webapp.
- Tests: 86 unit-/integratietests (waarvan 20 RLS-tests), 21 E2E-tests in lokale modus en 6 E2E-tests in cloudmodus
  tegen een echte lokale Supabase.

## Fase 3: opgeleverd

- Philips Hue-adapter op de officiële lokale API (zie docs/integrations.md), met certificaat-pinning en versleutelde key.
- Hue-koppelen vanuit Instellingen: zoeken, link-knopflow, handmatig IP, ontkoppelen (wist de key en de lampen).
- Connector: adapters toevoegen en verwijderen terwijl hij draait; gekoppelde bridges herstellen na een herstart.
- Registry-spiegel naar Supabase (`devices`, `device_states`, `device_events`, `connector_status`) zolang een beheerder
  verbonden is.
- macOS: `npm run connector:install:macos` installeert de connector als LaunchAgent (autostart, herstart na crash,
  logboeken in ~/Library/Logs/HomeOS). `npm run dev` herkent een draaiende connector.
- Hue-bridgesimulator voor ontwikkeling (`tests/tools/hue-bridge-simulator.mjs`), duidelijk gemarkeerd als simulator.
- Tests: 100 unit- en integratietests. Hue is end-to-end getest tegen de simulator, inclusief een certificaatwissel.

## Fase 4a: opgeleverd

- Klimaat in het datamodel (`climate`-capability, modus- en temperatuuropdrachten, migratie 2), airco-bediening in
  apparaatkaarten en een Klimaat-kaart op het dashboard, plus Jarvis ("zet de airco op 21 graden", "hoe warm is het").
- SolarEdge-adapter (opwek, historie, budget) en Daikin Onecta-adapter (OAuth, bediening, budget, token-vernieuwing),
  met instelkaarten in Instellingen.
- Energiepagina toont eerlijk "niet gemeten" voor verbruik en net zonder meter.
- Versheid per bron: cloud-bronnen met een ververs-interval van 10 minuten worden niet onterecht als verouderd gemarkeerd,
  en tonen hun echte meettijd.
- DEMO-airco in het demohuis.
- Tests: 120 unit- en integratietests, 24 E2E-tests in lokale modus en 6 in cloudmodus.

## Fase 4b: opgeleverd
- Smart Life/Tuya-adapter (officiële Cloud OpenAPI, handtekening geverifieerd tegen Tuya's SDK's), instelkaart.
- Matter-controller (matter.js) voor de IKEA GRILLPLATS en andere Matter-apparaten, experimenteel; de connector blijft
  stabiel als Matter niet kan starten.
- Apple TV onderzocht: geen officiële route → niet ondersteund. Tapo D235 op batterij: geen officiële route.
- Tests: 132 unit- en integratietests, 24 E2E-tests (lokaal), 6 (cloud).

## Fase 5: opgeleverd

- `@homeos/automation`: eigen rules engine met triggers (tijdstip + dagen, apparaatstatus, energie-drempel,
  apparaat offline, handmatig), voorwaarden (tijdvenster, dagen, apparaat online/aan, energie) en acties (Hue-scène,
  apparaat aan/uit, melding met variabelen, Jarvis-rapport, wachten).
- Veiligheid: geen inhaalacties na uitval, drempels alleen op een overgang, één run tegelijk, afkoeltijd, max. runs per
  dag, noodstop blokkeert runs, deurbel/meters/bridges nooit automatisch, alle opdrachten via de registry (bron
  "automation", met auditlog).
- Draait lokaal in de connector (tick elke 20 s); automatiseringen en geschiedenis staan in de datamap.
- Meldingen in de app (bel, toasts) met instelbare categorieën; deurbel → beveiligingsmelding; mislukte runs → melding.
- Automatiseringen-pagina met sjablonen (Avondmodus, Energiemelding, Apparaat offline), editor, pauzeren, nu uitvoeren,
  verwijderen en uitvoeringsgeschiedenis; dashboardkaart met volgende run en laatste resultaten.
- Jarvis stelt automatiseringen voor en maakt ze na bevestiging aan.
- Cloudmodus: runs, automatiseringen en meldingen worden gespiegeld naar Supabase zolang een beheerder verbonden is
  (best-effort; niet apart end-to-end getest).
- Pushmeldingen op iPhone/iPad volgen in fase 7 (vereist de installeerbare app met service worker).
- Tests: 149 unit- en integratietests, 27 E2E-tests (lokaal), 6 (cloud).

## Fase 6: opgeleverd

- Keuze: Jarvis werkt **volledig lokaal en gratis**, zonder betaalde AI-dienst en zonder internet. Een Claude Pro-
  abonnement geeft geen API-toegang, dus een AI-provider zou apart betaald moeten worden.
- Nieuw pakket `@homeos/jarvis` met een provider-interface (`JarvisProvider`). Alleen de lokale provider bestaat; een
  AI-provider kan later worden toegevoegd en volgt dezelfde regels (alleen voorstellen, de gebruiker bevestigt).
- Slimmer begrip: kamers ("lampen in de woonkamer uit"), kleuren ("plafondlamp blauw"), warm/koel wit, feller en donkerder,
  percentages, getallen in woorden ("eenentwintig graden"), tikfouten in apparaatnamen, airco warmer/kouder.
- Meerdere opdrachten in één zin ("spots uit en staande lamp aan") en vervolgvragen ("welke lampen staan aan?" → "zet ze
  uit"). Het geheugen is alleen de vorige beurt en wordt door de browser meegestuurd; de server houdt geen toestand bij.
- Nieuwe vragen: weekoverzicht energie, automatiseringen opsommen, uitvoeren (rol lid+) en pauzeren (beheerder+),
  agenda per dag (vandaag, morgen, overmorgen), taken toevoegen, tijd en datum, begroeting met een korte stand van zaken.
- Gespreksgeschiedenis: in cloudmodus in Supabase (`ai_conversations`/`ai_messages`, alleen zichtbaar voor jezelf via
  RLS), in lokale modus in de browser (uit te zetten). Voorstellen uit een eerder gesprek verlopen en zijn niet meer te
  bevestigen. Nieuw gesprek en geschiedenis wissen.
- Jarvis-instellingen: voorlezen, keuze van Nederlandse stem, spreeksnelheid; AI-configuratie toont eerlijk dat alleen
  de lokale Jarvis actief is.
- E2E-omgeving start iedere run met een lege connector-datamap.
- Tests: 173 unit- en integratietests, 30 E2E-tests (lokaal), 6 (cloud).

## Na fase 6: LG-tv

- LG webOS-tv-integratie (OLED48CX6LB): koppelen met toestemming op de tv, certificaat-pinning, versleutelde client-key,
  aan (Wake-on-LAN), uit, volume, dempen, ingang/app. Tv-bediening in apparaatkaarten, Entertainment en het dashboard;
  Jarvis begrijpt "tv zachter", "tv op 20", "zet Netflix op", "tv naar HDMI 2".
- Nieuwe capabilities `volume`, `source_select`, `wake_on_lan` en opdrachten `set_volume`, `volume_step`, `set_mute`,
  `select_source`. Migratie 3 voegt `lg_webos` toe en weigert ook sleutelvarianten als `client_key` in de configuratie.
- Tests: 191 unit- en integratietests (met een nagebootste tv), 36 E2E-tests (lokaal), 6 (cloud). Echte test met de tv
  volgt bij de gebruiker thuis.

## Na fase 6: Tapo-camera's

- Tapo C500 via het officiële camera-account (ONVIF/RTSP): status, bewegingsmeldingen, draaien/kantelen, momentopname en
  live beeld (ffmpeg → MJPEG). Camerakaarten op Beveiliging, instelkaart Tapo-camera's, nieuwe rol-permissie
  `view_cameras` (geen gasten), camera's uitgesloten voor Jarvis en automatiseringen. Migratie 4 (apparaattype camera).
- Deurbel D235 blijft op batterij: geen officiële koppeling, dus niet toegevoegd.
- Tests: 205 unit- en integratietests (nagebootste ONVIF-camera, echte ffmpeg met testbeeld), 39 E2E (lokaal), 6 (cloud).

## Na fase 6: tv-afstandsbediening

- Virtuele afstandsbediening voor de LG-tv (opdracht `remote_button`, capability `remote_control`), met toetsenbord-
  bediening; zender bij de ingebouwde tuner; Jarvis: "volgende zender", "zender 7". Ziggo Next Mini via HDMI-CEC.
- Zonneplan Connect: geen officiële API → niet gekoppeld; alternatief voorgesteld (HomeWizard P1 + splitter).

## Na fase 6: Zonneplan Connect

- Op verzoek van de gebruiker: Zonneplan Connect (P1) via de niet-officiële app-API, alleen-lezen, inloggen met e-mailcode.
  Registry combineert opwek (SolarEdge) en meter tot eigen verbruik, ook in de historie. Migratie 5.
- Tests: 215 unit- en integratietests (nagebootste Zonneplan-server), 42 E2E (lokaal), 6 (cloud).

## Fase 7: opgeleverd

- Installeerbare app (PWA): manifest, iconen voor iPhone/iPad/Android (ook maskable), snelkoppelingen, service worker die
  alleen statische bestanden en een offline-pagina cachet (nooit gegevens, API's of camerabeelden).
- Pushmeldingen (Web Push/VAPID) vanaf de connector, met de bestaande meldingscategorieën; instelkaart "App en
  pushmeldingen" met installatie-uitleg voor iOS, testmelding en uitzetten. Verlopen abonnementen worden opgeruimd.
- Toegang vanaf je telefoon via Tailscale (`npm run remote:on`): geen open poorten, alleen eigen apparaten, https.
  Webapp als LaunchAgent (`npm run web:install:macos`). Toegangscode verplicht voor de lokale modus van buiten de laptop.
- Keuze: geen Vercel-deployment met cloudrelais (zie docs/remote-access.md); kan later.
- Tests: 219 unit- en integratietests, 44 E2E (lokaal, o.a. service worker, offline, toegangscode), 6 (cloud).

## Fase 7b: cloudmodus (zonder laptop)

- Op verzoek van de gebruiker (MacBook blijft uit): HomeOS volledig op Vercel + Supabase. De connector draait per
  aanvraag in de webapp; opslag in Supabase (`cloud_documents`/`cloud_logs`, migratie 6) via een eigen beperkte rol
  `homeos_worker` (geen service role key). Adapters bewaren gegevens en budgetten tussen aanvragen en verversen alleen
  als nodig. Geplande taak elke minuut via pg_cron (`/api/cloud/tick`, eigen geheim). Koppelpogingen (Daikin, Zonneplan,
  Hue) versleuteld bewaard in plaats van in het geheugen.
- Philips Hue via de officiële Hue Remote API (OAuth, app-key via de cloud, CLIP v2), ook bruikbaar zonder laptop.
- Lokale integraties (Hue-bridge, LG-tv, Tapo-camera, Matter) zijn in de cloudmodus uitgeschakeld en verborgen.
- `npm run cloud:setup` richt de database in en schrijft de Vercel-waarden naar een privébestand. Zie docs/cloud.md.
- Tests: unit/integratie inclusief serverless-modus en Hue-cloud, E2E van de cloudmodus zonder connector-proces.
- **Google Home** (op verzoek, voor de IKEA GRILLPLATS die in Google Home staat): via de officiële Google Assistant SDK
  (Embedded Assistant v1alpha2, gRPC over HTTP/2, zonder extra pakketten). Alleen aan/uit als tekstopdracht
  ("turn on <naam>"; de SDK accepteert geen nl-NL, dus Engels); Google meldt de werkelijke toestand niet, dus de status blijft "onbekend" en de app toont losse
  Aan/Uit-knoppen in plaats van een schakelaar. De gebruiker kiest zelf welke apparaten (naam zoals in Google Home).
  Daglimiet 450 opdrachten. Kanttekening: Google vervangt Assistent door Gemini; deze route kan ooit stoppen.
- **Apple-agenda** (op verzoek): iCloud via CalDAV met een app-specifiek wachtwoord, alleen-lezen. Herhalingen,
  uitzonderingen en tijdzones via ical.js; afspraken bij Familie → Agenda (gemarkeerd "Apple", niet te verwijderen).
- **Apple Woning via Opdrachten** (op verzoek, voor de LG-tv in Apple Woning): knoppen die een Apple-opdracht starten
  via de officiële `shortcuts://`-link. Alleen handmatig op een Apple-apparaat; HomeOS ziet de uitkomst niet.
  Ziggo Next Mini: mee aan/uit via HDMI-CEC; zenders alleen via de Ziggo GO-app (geen officiële API).
- Onderzocht en afgevallen: geen cloud-API voor de LG-tv (ThinQ Connect ondersteunt geen tv's) of live camerabeeld;
  IKEA DIRIGERA heeft alleen een lokale (niet-officiële) API. Daarvoor blijft een kastje thuis nodig (optioneel, later).

## Fase 8: opgeleverd (beveiliging, tests, optimalisatie, documentatie)

- **Beveiligingsaudit:** `npm audit` 0 kwetsbaarheden; Supabase-advies doorgelopen (migratie 7: interne functies dicht;
  `pg_net` naar schema `extensions`; bewuste `SECURITY DEFINER`-functies gedocumenteerd); Content-Security-Policy op alle
  pagina's; metadata-adressen van cloudservers geweigerd als apparaatadres; geen geheimen in Git. Zie docs/security.md.
- **Tests:** 254 unit-/integratietests (dekking ±81% van de connector en pakketten), 50 E2E-tests op desktop, iPhone en
  iPad tegen een productiebuild (incl. CSP). De cloud-E2E (`playwright.cloudruntime.config.ts`) vraagt Docker; de
  serverless-modus is daarnaast gedekt met unit-tests en live gecontroleerd (geplande taak 200 OK).
- **Optimalisatie:** cloudopslag leest alle documenten in één query per aanvraag en schrijft alleen gewijzigde
  documenten; 17 indexen op foreign keys (migratie 8).
- **Nieuw op verzoek tijdens fase 8:** Google Home, "Alles uit", Apple-agenda, Apple Woning via Opdrachten, privacypagina.
- **Ziggo Mediabox** (op uitdrukkelijk verzoek, niet-officieel): zenders kiezen (lijst bij Entertainment), aan/stand-by
  met statuscontrole, afspelen/pauzeren en afstandsbedieningsknoppen. Eigen MQTT-client over wss, korte sessies (werkt
  in de cloudmodus).
- **Jarvis en Ziggo:** "zet RTL 4 op", "zender 7", "ziggo naar NPO 1 Extra", "wat staat er op de ziggo?" (zenders op naam of nummer, langste naam wint; Netflix blijft op de tv).
- **Tapo-camera's via de TP-Link-cloud** (op uitdrukkelijk verzoek, niet-officieel): meldingen (beweging/persoon/
  aanbellen), privacymodus en draaien zonder apparaat thuis; inloggen met verificatiecode (MFA). Live beeld via TP-Links
  videorelais: MPEG-TS (H.264) ongewijzigd doorgegeven naar de browser (mpegts.js), max. 4 minuten, alleen leden,
  in de auditlog, niets opgeslagen.
- **Na fase 8 (op verzoek):** melding van deurbel/camera aantikken opent direct het live beeld (foto's in
  pushmeldingen kan iPhone niet tonen en TP-Link stuurt ze niet mee); geluid bij live beeld (G.711 uit de MPEG-TS-stroom,
  in de browser gedecodeerd, standaard uit); wekelijks energieverslag op zondag vanaf 18:00 als pushmelding.
- **Zelf te doen (optioneel):** Supabase → Authentication → wachtwoorden uit datalekken weigeren.

## Antwoorden en openstaande vragen
- Stekkers: Smart Life / Tuya → Tuya Cloud OpenAPI (fase 4).
- Omvormer: SolarEdge → Monitoring API; geen energiemeter en geen P1 → alleen opwek.
- Deurbel: Tapo → welk model precies (D230, D235, D225)?
- Laptop: macOS → LaunchAgent (gebouwd).
- Airco: 2× Daikin in Onecta → officiële Onecta Cloud API (gebouwd).
- IKEA: DIRIGERA + GRILLPLATS → Matter (fase 4b). Tuya/Daikin via cloud: akkoord.

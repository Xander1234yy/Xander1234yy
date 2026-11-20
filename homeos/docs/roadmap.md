# Roadmap en implementatieplan

| Fase | Inhoud | Status |
| --- | --- | --- |
| 1 | Architectuur, monorepo, design system, dashboard, DEMO-apparaten, lokale dev-omgeving | ✅ Klaar |
| 2 | Supabase: schema en migraties (alle 20 tabellen), RLS, Auth, huishoudens, kamers naar de database, familie en onderhoud | ✅ Klaar |
| 3 | Philips Hue-adapter, pairing, apparaatregistry naar Supabase (devices/device_states), macOS-autostart | ✅ Klaar |
| 4 | Stekkers, Apple TV (onderzoek), zonnepanelen, deurbel | |
| 5 | Automation Engine, notificaties, geschiedenis | |
| 6 | Jarvis AI-provider (provider-interface), spraak, opdrachtverwerking | |
| 7 | PWA (service worker, offline cache, iOS-iconen), cloudkoppeling van de connector, Vercel-deployment | |
| 8 | Beveiligingsaudit, volledige tests, documentatie, optimalisatie | |

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

## Fase 4b: volgende
- Smart Life/Tuya-stekkers (Tuya Cloud OpenAPI).
- IKEA GRILLPLATS via Matter (matter.js-controller, multi-admin).
- Apple TV-onderzoek; Tapo D235 blijft "niet ondersteund" zolang hij op batterij werkt.

## Antwoorden en openstaande vragen
- Stekkers: Smart Life / Tuya → Tuya Cloud OpenAPI (fase 4).
- Omvormer: SolarEdge → Monitoring API; geen energiemeter en geen P1 → alleen opwek.
- Deurbel: Tapo → welk model precies (D230, D235, D225)?
- Laptop: macOS → LaunchAgent (gebouwd).
- Airco: 2× Daikin in Onecta → officiële Onecta Cloud API (gebouwd).
- IKEA: DIRIGERA + GRILLPLATS → Matter (fase 4b). Tuya/Daikin via cloud: akkoord.

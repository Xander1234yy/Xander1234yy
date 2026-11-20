# Roadmap en implementatieplan

| Fase | Inhoud | Status |
| --- | --- | --- |
| 1 | Architectuur, monorepo, design system, dashboard, DEMO-apparaten, lokale dev-omgeving | ✅ Klaar |
| 2 | Supabase: schema en migraties (alle 20 tabellen), RLS, Auth, huishoudens, kamers naar de database, familie en onderhoud | ✅ Klaar |
| 3 | Philips Hue-adapter, pairing, apparaatregistry naar Supabase (devices/device_states), macOS-autostart | ✅ Klaar |
| 4 | Stekkers, Apple TV (onderzoek), zonnepanelen, deurbel | |
| 5 | Automation Engine, notificaties, geschiedenis | ✅ Klaar |
| 6 | Jarvis: lokaal en gratis, provider-interface, spraak, opdrachtverwerking, geschiedenis | ✅ Klaar |
| 7 | PWA (service worker, offline cache, iOS-iconen), cloudkoppeling van de connector, Vercel-deployment | ⏭ Volgende |
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

## Antwoorden en openstaande vragen
- Stekkers: Smart Life / Tuya → Tuya Cloud OpenAPI (fase 4).
- Omvormer: SolarEdge → Monitoring API; geen energiemeter en geen P1 → alleen opwek.
- Deurbel: Tapo → welk model precies (D230, D235, D225)?
- Laptop: macOS → LaunchAgent (gebouwd).
- Airco: 2× Daikin in Onecta → officiële Onecta Cloud API (gebouwd).
- IKEA: DIRIGERA + GRILLPLATS → Matter (fase 4b). Tuya/Daikin via cloud: akkoord.

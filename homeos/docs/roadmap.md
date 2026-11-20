# Roadmap en implementatieplan

| Fase | Inhoud | Status |
| --- | --- | --- |
| 1 | Architectuur, monorepo, design system, dashboard, DEMO-apparaten, lokale dev-omgeving | ✅ Klaar |
| 2 | Supabase: schema en migraties (alle 20 tabellen), RLS, Auth, huishoudens, kamers naar de database, familie en onderhoud | ✅ Klaar |
| 3 | Philips Hue-adapter, pairing, apparaatregistry naar Supabase (devices/device_states) | ⏭ Volgende |
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

## Openstaande vragen voor fase 3 en 4
1. Welk merk en type slimme stekkers?
2. Welk merk en type omvormer, en is er een slimme meter met P1-poort (bijv. HomeWizard)?
3. Welk merk deurbel?
4. Welk besturingssysteem draait op de laptop van de connector (voor autostart: launchd, systemd of Windows-service)?

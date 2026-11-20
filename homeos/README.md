# HomeOS

**Your home. One intelligent system.**

HomeOS is een zelfstandig smart-homeplatform, zonder Home Assistant. De webapp draait in de browser
(iPhone, iPad, laptop) en een lichte **Device Connector** draait op je eigen laptop en praat lokaal met je apparaten.

> **Status: fase 4 van 8 afgerond.** Philips Hue (lokaal), SolarEdge, Daikin Onecta en Smart Life/Tuya (officiële
> cloud-API's) en Matter (experimenteel, o.a. IKEA) zijn gebouwd. Dashboard, Device Connector, accounts, huishoudens, rollen en een Supabase-database
> met Row Level Security. Familie (agenda, taken, boodschappen, notities) en Onderhoud werken.
> Apparaten zijn nog gesimuleerd en overal gemarkeerd als **DEMO**. Echte integraties volgen vanaf fase 3
> (Philips Hue). Zie [docs/roadmap.md](docs/roadmap.md).

## Snel starten

Vereist: Node.js 20.9 of nieuwer. Docker of extra hardware is niet nodig.

```bash
cd homeos
npm install
npm run dev
```

Open daarna **http://127.0.0.1:3000**.

`npm run dev` start twee processen:

| Proces | Adres | Wat het doet |
| --- | --- | --- |
| Device Connector | `127.0.0.1:8787` (alleen lokaal) | Apparaten, statuscache, opdrachten, auditlog |
| Webapp (Next.js) | `127.0.0.1:3000` | Dashboard en alle pagina's, plus een veilige server-side proxy naar de connector |

Zonder verdere configuratie draait HomeOS in de **lokale modus** (geen accounts, alleen op deze laptop).
Voor accounts, huishoudens, familie en onderhoud koppel je Supabase: zie [docs/supabase.md](docs/supabase.md).

Bij de eerste start maakt de connector een unieke identiteit en een toegangstoken aan in
`apps/connector/.data/` (bestandsrechten 0600, nooit in git). De webapp leest dat token server-side.

## Connector automatisch starten op je Mac

```bash
npm run connector:install:macos             # zonder DEMO-apparaten
npm run connector:install:macos -- --demo   # met DEMO-apparaten
npm run connector:uninstall:macos
```

De connector start dan bij het inloggen en herstart na een crash. Logboeken staan in `~/Library/Logs/HomeOS/`.
Sta "Lokaal netwerk" toe als macOS daarom vraagt; dat is nodig voor de Hue Bridge. Koppel daarna je bridge via
**Instellingen → Philips Hue**.

## Scripts

| Script | Doel |
| --- | --- |
| `npm run dev` | Connector en webapp samen starten |
| `npm run dev:web` / `npm run dev:connector` | Eén van de twee starten |
| `npm run start:connector` | Connector zonder watch-modus (voor dagelijks gebruik op de laptop) |
| `npm run build` / `npm start` | Productiebuild van de webapp maken en starten |
| `npm test` | Unit- en integratietests (Vitest) |
| `npm run test:e2e` | Browsertests op desktop, iPhone en iPad (Playwright, alleen DEMO-apparaten) |
| `npm run typecheck` / `npm run lint` | TypeScript strict en ESLint |
| `npm run check` | Typecheck, lint en tests samen |
| `npm run test:e2e:cloud` | Browsertests van accounts en rollen tegen een echte Supabase |
| `npm run db:migrate` / `npm run db:status` | Migraties toepassen op Supabase (`SUPABASE_DB_URL`) |
| `npm run supabase:start` / `supabase:stop` | Lokale Supabase (vereist Docker) |

## Structuur

```
homeos/
  apps/
    web/            Next.js App Router: UI + server-side API (proxy, SSE-stream, Jarvis)
    connector/      HomeOS Device Connector (standalone Node.js, los van Next.js)
  packages/
    shared/         Types, zod-schema's, opdrachtcontrole, versheid, energieberekening
    integrations/   Adapterinterface + DEMO-adapters (later Hue, stekkers, Apple TV, zon, deurbel)
    ui/             Design system (shadcn/ui-stijl op Radix + Tailwind)
    automation/     Automation Engine (fase 5)
    database/       Rijtypen, invoerschema's en RLS-tests
  supabase/         Migraties, seed (DEMO) en config voor de Supabase CLI
  docs/             Architectuur, beveiliging, integraties, roadmap
  tests/e2e/        Playwright
  scripts/          dev-launcher en hulpscripts
```

## Documentatie

- [Architectuur](docs/architecture.md)
- [Supabase, accounts en rechten](docs/supabase.md)
- [Beveiliging](docs/security.md)
- [Integraties en apparaatonderzoek](docs/integrations.md)
- [Roadmap en implementatieplan](docs/roadmap.md)
- [Connector-API](docs/connector-api.md)

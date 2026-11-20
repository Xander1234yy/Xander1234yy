# Supabase: accounts, huishoudens en database

HomeOS kent twee modi:

| Modus | Wanneer | Wat werkt |
| --- | --- | --- |
| **Lokaal** | `SUPABASE_URL` niet gezet | Fase 1-gedrag: geen accounts, alleen bereikbaar op 127.0.0.1. Familie en Onderhoud zijn uitgeschakeld. |
| **Cloud** | `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` gezet | Inloggen, huishoudens, rollen, familie, onderhoud en kamers in Supabase, met RLS op alles. |

In productie (`NODE_ENV=production`) weigert HomeOS de lokale modus. Bezoekers zien dan de pagina `/setup`, tenzij
`HOMEOS_ALLOW_LOCAL_MODE=true` bewust gezet is.

## Gehoste Supabase (aanbevolen)

1. Maak een project op supabase.com (de gratis laag is genoeg).
2. Voer de migraties uit vanaf je laptop:
   ```bash
   SUPABASE_DB_URL='postgresql://postgres:<wachtwoord>@db.<ref>.supabase.co:5432/postgres' npm run db:migrate
   npm run db:status   # controleren
   ```
   De administratie is gelijk aan die van de Supabase CLI, dus `supabase db push` kan later ook.
3. Stel in Supabase in: **Authentication → URL Configuration**
   - Site URL: de adres van je webapp (bijv. `http://127.0.0.1:3000` lokaal)
   - Redirect URL's: `<site>/auth/confirm`
   - Aanbevolen: e-mailbevestiging aan, minimale wachtwoordlengte 10.
4. Zet in `apps/web/.env.local` (of als Vercel-variabelen, fase 7):
   ```
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   HOMEOS_SITE_URL=http://127.0.0.1:3000
   ```
5. `npm run dev`, registreer een account, maak een huishouden aan en koppel de connector via **Instellingen → Connectorkoppeling**.

De **service role key / secret key is niet nodig** en hoort nergens in HomeOS. Alle toegang loopt met de sessie van de
ingelogde gebruiker, zodat Row Level Security altijd geldt.

## Lokale Supabase (ontwikkeling, vereist Docker)

```bash
npm run supabase:start   # start Postgres, Auth, REST en de gateway; past migraties en seed.sql toe
```

De CLI toont de URL en de publishable key. De seed maakt een **DEMO-account** aan: `demo@homeos.local` met wachtwoord
`homeos-demo-wachtwoord`, en het huishouden "Demohuis (DEMO)" met DEMO-gegevens. Gebruik de seed alleen lokaal.

## Datamodel

Zie `supabase/migrations/20261120000100_homeos_core.sql`. Kort samengevat:

- `profiles`: wordt automatisch aangemaakt bij registratie.
- `households` en `household_members` met de rollen `owner`, `admin`, `member` en `guest`.
- Kamers, apparaten, integraties, statussen, gebeurtenissen, energie, automatiseringen, meldingen, familie, onderhoud,
  Jarvis, auditlog en connector-status.
- Huishoudbeheer loopt via RPC's (`create_household`, `add_household_member`, `set_household_member_role`,
  `remove_household_member`, `household_member_list`) met regels zoals "er blijft minimaal één eigenaar".

### Rechten (RLS)

| Gegevens | Lezen | Schrijven |
| --- | --- | --- |
| Huishouden, leden | alle leden | via RPC's (beheerder of eigenaar) |
| Kamers, apparaten, integraties, energie, automatiseringen, connector | alle leden | beheerder en hoger |
| Agenda, taken, boodschappen, notities, onderhoud | alle leden (ook gasten) | lid en hoger |
| Persoonlijke meldingen | alleen de ontvanger | — |
| Jarvis-gesprekken | alleen jijzelf | alleen jijzelf |
| Auditlog | beheerder en hoger | alleen toevoegen, nooit wijzigen of verwijderen |

`device_integrations.config` weigert sleutels zoals `token`, `password` en `api_key`. Integratiegeheimen blijven
versleuteld op de laptop (connector).

## Tests

```bash
npm test                 # o.a. RLS-tests op een echte Postgres in-process (PGlite), geen Docker nodig
npm run supabase:start   # daarna:
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE_KEY=<key> npm run test:e2e:cloud
```

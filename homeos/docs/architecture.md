# Architectuur

```
 iPhone / iPad / laptop (browser, PWA)
        │  HTTPS, same-origin
        ▼
 ┌──────────────────────────────┐        fase 2+
 │ HomeOS Web + Cloud API       │ ─────────────────► Supabase (Auth, Postgres+RLS, Storage, Realtime)
 │ Next.js (apps/web)           │
 │  • UI (React, Tailwind, UI)  │
 │  • /api/connector/* proxy    │  allowlist + CSRF-check, token alleen server-side
 │  • /api/stream (SSE)         │  realtime relay
 │  • /api/jarvis               │  interpretatie → voorstel (nooit uitvoering)
 └──────────────┬───────────────┘
                │ HTTP + WebSocket met Bearer-token (lokaal: 127.0.0.1)
                ▼
 ┌──────────────────────────────┐
 │ HomeOS Device Connector      │  standalone Node.js op de laptop (apps/connector)
 │  • DeviceRegistry            │  statuscache, kamers, toevoegen/verwijderen, auditlog
 │  • checkCommand()            │  capabilities, status, noodstop, veiligheidskritisch
 │  • SecretStore (AES-256-GCM) │  integratietokens, alleen lokaal
 │  • Adapters                  │  DEMO nu; Hue (3); stekkers, Apple TV, zon, deurbel (4)
 │  • Automation Engine (5)     │
 └──────────────┬───────────────┘
                ▼
       Apparaten op het thuisnetwerk (lokale, officiële API's)
```

## Vijf onderdelen

| Onderdeel | Locatie | Status |
| --- | --- | --- |
| A. Frontend | `apps/web/app`, `apps/web/components`, `packages/ui` | Fase 1 ✔ |
| B. Cloud API | `apps/web/app/api` (nu proxy, stream, Jarvis), later Supabase | Deels; fase 2 |
| C. Device Connector | `apps/connector` | Fase 1 ✔ (registry, API, WS, beveiliging, DEMO) |
| D. Automation Engine | `packages/automation` → draait in connector | Fase 5 |
| E. Intelligence (Jarvis) | `packages/jarvis` (provider-interface, lokale Jarvis), `apps/web/app/api/jarvis` | Lokaal ✔ (fase 6); geen betaalde AI-provider |

## Gegevensstroom bij een opdracht

1. De gebruiker tikt op een schakelaar, of bevestigt een Jarvis-voorstel.
2. De browser stuurt `POST /api/connector/v1/devices/:id/commands` (same-origin).
3. Next.js controleert de allowlist en de Origin, en voegt server-side het connector-token toe.
4. De connector valideert met zod, controleert rate limits en `checkCommand()`, en voert de opdracht via de adapter uit.
5. Het resultaat (de werkelijke nieuwe status) komt terug en wordt in het auditlog vastgelegd. Er is geen optimistische UI.
6. Via WebSocket → SSE krijgen alle open schermen de nieuwe snapshot.

## Accounts en huishoudens (fase 2)

```
 browser ──cookie (httpOnly)──► proxy.ts ── getUser() ──► Supabase Auth
                                  │
                                  ▼
            Server Components / Server Actions / API-routes
              • getSession(): gebruiker + actief huishouden + rol
              • can(rol, permissie)
              • Supabase-queries met de sessie van de gebruiker  ──► Postgres (RLS)
              • connector-proxy: rol + gekoppelde connector + audit
```

- De rol bepaalt wat iemand mag (`packages/shared/src/permissions.ts`) en de database dwingt hetzelfde af via RLS.
- Kamers zijn leidend in Supabase. De connector krijgt de lijst via `PUT /v1/rooms` (kamer-ID = slug).
- In de connector-registry staan nog alleen apparaatnamen en kamertoewijzingen. Synchronisatie naar de Supabase-tabel
  `devices` volgt in fase 3.

## Cloud versus lokaal

Fase 1 draait volledig lokaal: de webapp en de connector staan op dezelfde laptop. Voor gebruik buiten huis (fase 7)
maakt de connector een **uitgaande**, versleutelde verbinding met de cloud (Supabase Realtime-kanaal per connector,
geauthenticeerd met de connectoridentiteit). Er worden geen poorten opengezet. Opdrachten worden dan nog steeds door de
connector gecontroleerd en nooit in een wachtrij gezet: is de laptop offline, dan mislukt de opdracht direct en zichtbaar.

## Offline-gedrag (al geïmplementeerd)

- De UI toont cloud en connector los van elkaar (`ConnectionPill`).
- Is de connector offline, dan verschijnt een banner met de laatste synchronisatietijd. De apparaatstatus wordt
  `UNKNOWN`, alle bediening staat uit en gegevens zijn gedimd of gemarkeerd als "laatst bekend".
- De laatst bekende snapshot staat in localStorage (alleen niet-geheime status) en wordt altijd als niet-live getoond.
- Na een herstart synchroniseert de connector eerst alle statussen. Oude opdrachten worden nooit opnieuw uitgevoerd.

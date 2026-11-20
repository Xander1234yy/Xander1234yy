# CLAUDE.md — werkafspraken voor HomeOS

## Wat dit is
Monorepo (npm workspaces) voor HomeOS: Next.js-webapp (`apps/web`), losse Device Connector (`apps/connector`),
gedeelde pakketten in `packages/*`. Interne pakketten worden als TypeScript-bron gebruikt (geen buildstap):
Next transpileert ze (`transpilePackages`), de connector draait via `tsx`.

## Commando's
- `npm run dev`: connector en web. `npm test`: Vitest. `npm run test:e2e`: Playwright. `npm run check`: alles.
- In de Claude Code-cloudomgeving: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome npm run test:e2e`.
- Cloudmodus testen: `npm run supabase:start` (Docker), dan `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE_KEY=<key> npm run test:e2e:cloud`.

## Harde regels
1. **Geen nep-integraties.** Gesimuleerde apparaten bestaan alleen als DEMO-adapter (`demo: true`) en worden in de UI
   altijd zo gemarkeerd. Echte adapters alleen op basis van officiële documentatie. Ontbreekt die, maak dan een duidelijk
   gemarkeerde stub die `not_configured` of een fout teruggeeft. Meld nooit een verbinding als geslaagd als dat niet zo is.
   **Enige uitzondering (expliciet gevraagd door de gebruiker):** Zonneplan Connect via de niet-officiële app-API,
   alleen-lezen en overal gemarkeerd als niet-officieel. Voeg geen andere niet-officiële koppelingen toe zonder expliciet verzoek.
2. **Secrets.** Geen tokens in frontendcode, `NEXT_PUBLIC_*` of localStorage. Integratietokens alleen via
   `SecretStore` (AES-256-GCM) in de connector. Het connector-token alleen server-side.
3. **Opdrachten.** Alles gaat via `DeviceRegistry.executeCommand` → `checkCommand()` (capability, status, noodstop,
   veiligheidskritische apparaten) → auditlog. Jarvis en automatiseringen doen alleen voorstellen of gebruiken de bron
   `jarvis`/`automation`. Opdrachten worden nooit in een wachtrij gezet voor later.
4. **Versheid.** Toon oude status nooit als live. Gebruik `stateFreshness`/`effectiveStatus` en `useLive()`.
5. **Validatie.** Alle API-input via zod-schema's uit `@homeos/shared`. Nieuwe connector-endpoints ook toevoegen aan
   `apps/web/lib/server/allowlist.ts`, anders zijn ze niet bereikbaar.
6. **Tests** voeren nooit echte apparaatopdrachten uit. Ze gebruiken alleen DEMO-adapters en tijdelijke datamappen.
7. UI-tekst is in het Nederlands. Design: donker navy/zwart met blauwe accenten (tokens in `apps/web/app/globals.css`).
8. **Database.** Iedere nieuwe tabel krijgt RLS en policies in een *nieuwe* migratie (bestaande migraties nooit
   wijzigen), plus tests in `packages/database/test/rls.test.ts`. Rechten in `permissions.ts` moeten de RLS volgen.
   Supabase alleen server-side, nooit een service role key in de webapp.
9. Next.js 16: lees `apps/web/AGENTS.md` en `node_modules/next/dist/docs/` voordat je Next-API's gebruikt.

## Automatiseringen
- Engine in `packages/automation/src/engine.ts` (puur, getest met nagebootste klok); inbouw in
  `apps/connector/src/automation-service.ts`. Nooit inhaalacties, drempels alleen op overgangen, apparaatopdrachten
  altijd via `registry.executeCommand(..., "automation")`.

## Jarvis
- `packages/jarvis`: `JarvisProvider`-interface en `LocalJarvis` (puur, getest in `packages/jarvis/test`). Alleen
  voorstellen teruggeven; uitvoeren gebeurt in `components/jarvis-chat.tsx` na bevestiging via de normale API's.
  Bewust geen betaalde AI-provider (keuze van de gebruiker).

## Integraties
- Hue zonder hardware testen: `sudo node tests/tools/hue-bridge-simulator.mjs --host <privé-IP>` (poort 443, alleen een
  simulator). Tests gebruiken `packages/integrations/test/fake-bridge.ts`, nooit het netwerk.
- Matter: `apps/connector/src/matter-backend.ts` (matter.js, dynamisch geladen). Tests via
  `packages/integrations/test/fake-matter.ts`; de cloudomgeving heeft geen IPv6, dus echte Matter-tests alleen lokaal.
- LG-tv: `packages/integrations/src/webos` (SSAP over wss). Tests via `packages/integrations/test/fake-webos.ts`,
  nooit een echte tv. Wake-on-LAN alleen via de geïnjecteerde `wol`-functie in tests.
- Tapo-camera's: `packages/integrations/src/tapo` (ONVIF + ffmpeg/MJPEG). Tests via
  `packages/integrations/test/fake-onvif.ts` en een ffmpeg-testbeeld (`lavfi testsrc`), nooit een echte camera.
- Nieuwe adapters: implementeer `DeviceAdapter`, sla secrets alleen op via `ctx.secrets`, lees de werkelijke status terug
  na iedere opdracht, en geef een niet-ondersteunde functie als `UNSUPPORTED` terug in plaats van te gokken.

## Fase
Fase 1 t/m 6 zijn af. Zie `docs/roadmap.md` voor wat volgt en houd dat document bij.

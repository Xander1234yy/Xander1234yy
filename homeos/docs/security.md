# Beveiliging

| Maatregel | Waar |
| --- | --- |
| Connector luistert standaard alleen op 127.0.0.1 | `apps/connector/src/config.ts` |
| Unieke connectoridentiteit (UUID) en een willekeurig token van 256 bit, bestandsrechten 0600 | `identity.ts` |
| Timing-safe vergelijking van tokens | `identity.ts` (`tokensEqual`) |
| Weigert verzoeken met een `Origin`-header (geen directe browsertoegang) | `server.ts` |
| Host-header-allowlist tegen DNS-rebinding | `server.ts` |
| Rate limiting: algemeen en apart voor opdrachten | `rate-limit.ts` |
| Maximale grootte van verzoeken (64 KB), JSON- en zod-validatie | `server.ts` |
| WebSocket alleen met token; inkomende WS-berichten worden genegeerd (geen remote commands) | `server.ts` |
| Integratietokens versleuteld (AES-256-GCM, scrypt-sleutel), afgeschermd per adapter | `secret-store.ts` |
| Auditlog van iedere opdracht en beheeractie (JSONL, lokaal) | `registry.ts`, `journal.ts` |
| Noodstop blokkeert alle opdrachten van automatiseringen en Jarvis | `checkCommand()` |
| Jarvis en automatiseringen mogen deurbel, energiemeters en bridges niet bedienen | `SAFETY_CRITICAL_KINDS` |
| Webapp: token alleen server-side, nooit `NEXT_PUBLIC_*` of localStorage | `lib/server/connector-client.ts` |
| Webapp: allowlist van endpoints en same-origin-check (CSRF) op wijzigingen | `lib/server/allowlist.ts` |
| Security-headers (nosniff, frame DENY, COOP, Permissions-Policy) | `next.config.ts` |
| Webapp luistert in fase 1 alleen op 127.0.0.1 (accounts komen in fase 2) | `apps/web/package.json` |

## Bewuste beperkingen in fase 1

- Er zijn nog geen gebruikersaccounts. Daarom bindt de webapp aan 127.0.0.1. `npm run dev:lan -w @homeos/web` maakt de
  app bereikbaar op het thuisnetwerk (handig om op de iPhone te testen), maar **zonder login**. Gebruik dat alleen tijdelijk
  op een vertrouwd netwerk. In fase 2 komt Supabase Auth met sessies in httpOnly-cookies.
- Er is nog geen CSP met nonces. Die komt in fase 8.

## Token vernieuwen

```bash
npm run token -w @homeos/connector -- rotate   # daarna connector en webapp herstarten
```

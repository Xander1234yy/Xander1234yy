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

## Accounts en autorisatie (fase 2)

| Maatregel | Waar |
| --- | --- |
| Supabase Auth; sessie in **httpOnly**-cookies (SameSite=Lax, Secure in productie) | `lib/supabase/*`, `proxy.ts` |
| Supabase alleen server-side: geen Supabase-keys of tokens in de browser | `lib/supabase/config.ts` |
| Geen service role key: alle queries met de sessie van de gebruiker, dus RLS geldt altijd | overal |
| `proxy.ts` valideert de sessie bij Supabase (`getUser`) en beschermt alle pagina's en API's | `proxy.ts` |
| RLS op iedere tabel; rechten per rol; RPC's met `SECURITY DEFINER` en `search_path = ''` | migratie |
| Autorisatie in drie lagen: database (RLS), server (`can()` in actions en API) en UI | `@homeos/shared/permissions` |
| Connectorkoppeling: een huishouden kan alleen de eigen, gekoppelde connector bedienen | `lib/server/authz.ts` |
| Rate limiting op inloggen, registreren, wachtwoordherstel, Jarvis en connectoracties | `rateLimit()` |
| Algemene foutmelding bij inloggen (verraadt niet of een account bestaat) | `app/(auth)/actions.ts` |
| Bescherming tegen open redirects (`next`-parameter) | `lib/safe-redirect.ts` |
| Databasefouten worden vertaald zonder interne details te tonen | `friendlyDbError()` |
| Auditlog per huishouden, alleen toevoegen | `audit_logs` |
| Productie zonder Supabase geblokkeerd (`/setup`), tenzij expliciet `HOMEOS_ALLOW_LOCAL_MODE=true` | `proxy.ts` |

## Bewuste beperkingen

- In de **lokale modus** (geen Supabase) zijn er geen accounts. Daarom bindt de webapp aan 127.0.0.1. Met Supabase
  geconfigureerd is `npm run dev:lan -w @homeos/web` veilig om op je iPhone te testen, want iedere pagina vraagt dan om in te loggen.
- In fase 2 bereikt de webapp de connector nog direct via het lokale netwerk. De uitgaande cloudverbinding volgt in fase 7.
- Er is nog geen CSP met nonces. Die komt in fase 8.

## Token vernieuwen

```bash
npm run token -w @homeos/connector -- rotate   # daarna connector en webapp herstarten
```

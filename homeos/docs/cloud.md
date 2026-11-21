# HomeOS in de cloud (zonder laptop)

In de cloudmodus draait HomeOS volledig op **Vercel** (webapp) en **Supabase** (accounts en opslag). Je MacBook mag uit.
Beide hebben een gratis abonnement dat voor één huishouden ruim voldoende is.

## Wat werkt wel en niet

| Werkt in de cloud | Werkt alleen met een apparaat thuis |
| --- | --- |
| Daikin-airco (Onecta), Smart Life/Tuya-stekkers, SolarEdge, Zonneplan Connect (niet-officieel) | LG-tv en afstandsbediening |
| Philips Hue via de **Hue-cloud** (officiële Remote API) | Tapo-camera (C500) |
| Automatiseringen, meldingen, pushmeldingen, Jarvis, familie, onderhoud | Hue zonder cloud, live camerabeeld |
| Apparaten uit **Google Home** (bijv. IKEA GRILLPLATS), alleen aan/uit en zonder statusterugmelding | |
| **Apple-agenda** (iCloud, alleen-lezen) | |

Wil je de tv en camera later terug, dan kan er naast de cloud een klein kastje thuis bij (zie roadmap).

## Hoe het werkt

- Iedere aanvraag start de connector **in de webapp zelf** (geen apart programma). De status, instellingen, logboeken
  en versleutelde tokens staan in Supabase (`cloud_documents`, `cloud_logs`).
- **Geen service role key.** De webapp gebruikt een eigen, beperkte databaselogin (`homeos_worker_login`, lid van de rol
  `homeos_worker`) die alleen die twee tabellen mag gebruiken; gebruikers kunnen er via de API niet bij (RLS). De
  webapp gebruikt die login pas ná de normale controle van je account en rol.
- **Geheimen** (tokens van Daikin, Tuya, SolarEdge, Zonneplan, Hue) staan versleuteld (AES-256-GCM). De sleutel
  (`HOMEOS_CONNECTOR_SECRET`) staat alleen in Vercel.
- **Elke minuut** roept een geplande taak in Supabase (`pg_cron` + `pg_net`) de webapp aan (`/api/cloud/tick`, beveiligd
  met `HOMEOS_CRON_SECRET`): gegevens verversen als ze verouderd zijn, automatiseringen evalueren, pushmeldingen sturen.
  Geen inhaalacties; budgetten per dienst (bijv. Daikin 200/dag) blijven bewaard tussen aanvragen.
- De app ververst de status elke 15 seconden (geen blijvende verbinding, want serverless).

## Eenmalig instellen

1. **Supabase**: maak een gratis project op supabase.com. Noteer het databasewachtwoord.
2. **Vercel**: maak een gratis account op vercel.com, kies *Add New → Project* en importeer je GitHub-repository.
   - *Root Directory*: `homeos/apps/web` (met *Include files outside the root directory* aan; `apps/web/vercel.json`
     installeert vanuit de HomeOS-map).
   - Klik *Deploy* (de eerste keer mag mislukken; dat is normaal zonder instellingen).
   - Noteer het adres, bijvoorbeeld `https://homeos-xander.vercel.app`.
3. **Database inrichten** (op een computer met de repository, eenmalig):
   ```
   SUPABASE_DB_URL='postgresql://postgres:<databasewachtwoord>@db.<project-ref>.supabase.co:5432/postgres' \
     npm run cloud:setup -- --url https://homeos-xander.vercel.app
   ```
   Dit past de migraties toe, maakt de beperkte login en de geplande taak, en schrijft alle waarden voor Vercel naar
   `.homeos-cloud.env` (alleen voor jou leesbaar, staat niet in Git).
4. **Vercel → Settings → Environment Variables**: zet de waarden uit `.homeos-cloud.env` erin (behalve
   `__WORKER_PASSWORD`), en vul `SUPABASE_URL` en `SUPABASE_PUBLISHABLE_KEY` aan (Supabase → Project Settings → API).
   Gebruik voor `HOMEOS_WORKER_DB_URL` de *Transaction pooler* (poort 6543) uit Supabase → Connect, met gebruiker
   `homeos_worker_login.<project-ref>` en het wachtwoord uit het bestand. Klik daarna op *Redeploy*.
5. **Supabase → Authentication → URL Configuration**: zet *Site URL* op je Vercel-adres.
6. Open je Vercel-adres op je iPhone, maak een account en een huishouden, en zet HomeOS op je beginscherm
   (Deel → Zet op beginscherm). Pushmeldingen aanzetten bij Instellingen.
7. **Koppelingen opnieuw instellen** bij Instellingen (de tokens op je MacBook gaan niet automatisch mee):
   Daikin, Smart Life, SolarEdge, Zonneplan en **Philips Hue (cloud)**.

### Philips Hue via de Hue-cloud

1. Maak een gratis account op developers.meethue.com → *Remote Hue API appids* → *Add new Hue Remote API app*.
2. Callback URL: `https://<jouw-vercel-adres>/api/integrations/huecloud/callback` (staat ook in de instelkaart).
3. Vul in HomeOS de ClientId en ClientSecret in en klik *Inloggen bij Philips Hue*. Je logt in bij Philips en komt
   terug in HomeOS; HomeOS maakt dan zelf een sleutel aan via de Hue-cloud. De Hue Bridge moet online zijn
   (gekoppeld aan je Hue-account, zoals in de Hue-app).

### Google Home (bijv. IKEA-stekkers)

Via de officiële **Google Assistant SDK**: HomeOS stuurt "turn on/off <naam>" naar je Google-account (Google Assistent ondersteunt via deze API geen Nederlands; namen blijven zoals in Google Home), alsof je het
tegen Google zegt. Google meldt niet terug of het apparaat werkelijk schakelde; HomeOS toont de status daarom als
onbekend (losse Aan/Uit-knoppen).

1. console.cloud.google.com → nieuw project → *APIs & Services → Library* → **Google Assistant API** aanzetten.
2. *OAuth consent screen*: **External**, naam en e-mail invullen, daarna **Publish app** (anders verloopt de koppeling
   na 7 dagen). De melding "niet geverifieerd" bij het inloggen is normaal voor je eigen app.
3. *Credentials → OAuth client ID → Web application*, redirect URI:
   `https://<jouw-vercel-adres>/api/integrations/googlehome/callback` (staat ook in de instelkaart).
4. In HomeOS bij Instellingen → Google Home: client-ID en secret invullen, inloggen met het Google-account van je
   Google Home, en daarna de apparaatnamen precies zoals in Google Home invullen (één per regel).

### Apple-agenda (iCloud)

Alleen-lezen via CalDAV, de open standaard die Apple voor agenda-apps van derden ondersteunt.

1. appleid.apple.com → *Inloggen en beveiliging* → **App-specifieke wachtwoorden** → maak er een ("HomeOS").
2. HomeOS → Instellingen → Apple-agenda: Apple ID en dat wachtwoord invullen (nooit je gewone wachtwoord).
3. Kies welke agenda's je wilt zien. Afspraken (ook herhalingen) staan bij Familie → Agenda, gemarkeerd met "Apple",
   en worden hooguit elke 10 minuten opgehaald. Ontkoppelen wist de gegevens; trek het wachtwoord ook in bij Apple.

## Variabelen

| Variabele | Waarvoor |
| --- | --- |
| `HOMEOS_CLOUD_RUNTIME=true` | Cloudmodus aan |
| `HOMEOS_CONNECTOR_SECRET` | Sleutel voor de versleutelde opslag (min. 32 tekens) |
| `HOMEOS_CRON_SECRET` | Geheim van de geplande taak (min. 32 tekens) |
| `HOMEOS_WORKER_DB_URL` | Databaselogin `homeos_worker_login` (beperkt) |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Accounts (server-side) |
| `HOMEOS_SITE_URL` | Je Vercel-adres (e-mails, Daikin) |
| `HOMEOS_CLOUD_DEMO=true` | Alleen voor tests: DEMO-apparaten |

## Testen

`npm run supabase:start`, dan (met een login die lid is van `homeos_worker`):
```
HOMEOS_WORKER_DB_URL=postgresql://homeos_worker_login:<ww>@127.0.0.1:54322/postgres \
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE_KEY=<key> \
  npx playwright test -c playwright.cloudruntime.config.ts
```

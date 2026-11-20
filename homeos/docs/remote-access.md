# Toegang vanaf je telefoon (fase 7)

HomeOS draait op je MacBook. Je iPhone en iPad gebruiken het als **app op het beginscherm** (PWA), met pushmeldingen,
via **Tailscale**: een gratis, versleuteld privénetwerk tussen je eigen apparaten.

- **Geen open poorten** in je router en geen eigen cloudserver. Tailscale maakt alleen uitgaande verbindingen.
- **Alleen jouw apparaten** (in jouw tailnet) kunnen HomeOS bereiken. We gebruiken `tailscale serve`, niet
  `tailscale funnel` (dat zou HomeOS openbaar op internet zetten).
- **https met een geldig certificaat** (`https://<mac>.<tailnet>.ts.net`), nodig voor installeren en pushmeldingen.
- **Toegangscode** in de modus zonder accounts: verplicht zodra HomeOS van buiten de laptop wordt geopend.

## Eenmalig instellen

1. **Tailscale** installeren op de MacBook (Mac App Store of tailscale.com/download) en op je iPhone/iPad (App Store).
   Overal inloggen met hetzelfde account.
2. **Webapp altijd aan** op de MacBook (naast de connector):
   ```
   npm run connector:install:macos     # als dat nog niet gedaan is
   npm run web:install:macos           # bouwt en start de webapp; toont je toegangscode
   ```
3. **Toegang aanzetten**:
   ```
   npm run remote:on
   ```
   Het script toont het adres, bijvoorbeeld `https://macbook-van-xander.tail1234.ts.net`.
4. Op de **iPhone**: zet Tailscale aan, open het adres in **Safari**, vul de toegangscode in.
5. Tik op **Deel → Zet op beginscherm → Voeg toe**.
6. Open HomeOS vanaf het beginscherm → **Instellingen → App en pushmeldingen → Pushmeldingen aanzetten**.
   Kies welke soorten meldingen je wilt bij Meldingen.

Uitzetten: `npm run remote:off`. Nieuwe toegangscode: `npm run web:install:macos -- --new-code`.

## Hoe het werkt

| Onderdeel | Waar |
| --- | --- |
| Manifest, iconen (180/192/512, maskable) | `apps/web/app/manifest.ts`, `apps/web/public/*.png` |
| Service worker: alleen statische bestanden en een offline-pagina; nooit pagina's met gegevens, API's of beelden | `apps/web/public/sw.js` |
| Pushmeldingen (Web Push, VAPID) vanaf de connector rechtstreeks naar Apple/Google; sleutels en abonnementen versleuteld | `apps/connector/src/push-service.ts` |
| Toegangscode voor de lokale modus van buiten de laptop (httpOnly-cookie met HMAC, max. 5 pogingen/min) | `apps/web/lib/server/local-access.ts`, `proxy.ts` |
| LaunchAgent voor de webapp, Tailscale-script | `scripts/macos/install-web.sh`, `scripts/macos/remote-access.sh` |

- Meldingen gaan naar alle apparaten met pushmeldingen; categorieën die je uitzet bij Meldingen worden niet verstuurd.
  Beveiligingsmeldingen (beweging, deurbel) krijgen hoge urgentie.
- Alleen bekende pushdiensten zijn toegestaan als adres (Apple, Google/FCM, Mozilla, Microsoft), zodat de connector
  geen verzoeken naar willekeurige servers kan doen. Gasten kunnen geen pushmeldingen aanzetten.
- Offline toont de app een uitleg; er worden **geen opdrachten bewaard** om later uit te voeren.
- `HOMEOS_PUSH_SUBJECT` (optioneel): contactadres voor de pushdiensten, standaard een voorbeeldadres.

## Waarom (nog) geen Vercel

Een webapp op Vercel kan je MacBook alleen bereiken via een cloudrelais waar opdrachten doorheen gaan, of via open poorten.
Tailscale geeft hetzelfde gemak (overal bereikbaar, https, pushmeldingen) zonder dat opdrachten of camerabeelden via een
derde server lopen, en zonder kosten. De webapp is wel Vercel-klaar (Supabase-accounts, geen geheimen in de browser);
een uitgaande relaisverbinding voor de connector kan later worden toegevoegd als je HomeOS zonder Tailscale wilt gebruiken.

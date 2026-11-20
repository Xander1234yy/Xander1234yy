# Integraties

Iedere integratie implementeert `DeviceAdapter` (`packages/integrations/src/adapter.ts`):
`connect`, `disconnect`, `discover`, `getStatus`, `executeCommand`, `getCapabilities` en `healthCheck`, plus optioneel
`getScenes`/`activateScene` en `energy`. Adapters draaien uitsluitend in de connector.

**Regel:** alleen officiële, gedocumenteerde en toegestane koppelingen. Is een apparaat niet compatibel, dan geeft de
adapter de status `not_configured` of een fout met uitleg en een alternatief. Er wordt nooit een geslaagde verbinding verzonnen.

## Huidige adapters (fase 1)

| Adapter | Type | Opmerking |
| --- | --- | --- |
| `demo-lights` | DEMO | 6 lampen (waarvan 1 bewust offline), 4 scènes |
| `demo-plugs` | DEMO | 3 stekkers met energiemeting |
| `demo-media` | DEMO | Mediaspeler die het gedrag van een Apple TV nabootst |
| `demo-energy` | DEMO | Deterministisch zonne- en verbruiksmodel (omvormer en P1-meter) |
| `demo-doorbell` | DEMO | Belmeldingen en beweging, geen beelden |

DEMO-adapters worden alleen geladen als `HOMEOS_DEMO=true` (standaard in ontwikkeling, uit in productie).

## Onderzoeksplan per integratie

De onderstaande punten zijn uitgangspunten. Ze worden aan het begin van de betreffende fase opnieuw gecontroleerd
tegen de actuele officiële documentatie. Daarna wordt per merk vastgelegd wat wel en niet werkt.

### Philips Hue (fase 3)
- Officiële Hue Bridge API (CLIP v2, HTTPS lokaal), discovery via mDNS (`_hue._tcp`) en de officiële discovery-dienst.
- Pairing: de gebruiker drukt op de link-knop van de bridge, waarna de connector een application key opvraagt. Die key wordt
  versleuteld opgeslagen in `SecretStore` (namespace `philips-hue`).
- Lampen, kamers (rooms/zones), scènes, aan/uit, helderheid, kleur of kleurtemperatuur, en een event stream voor live status.
- Het certificaat van de bridge valideren volgens Philips' richtlijnen.

### Slimme stekkers (fase 4)
- Alleen merken met een gedocumenteerde lokale API. Kandidaten om te verifiëren: Shelly (lokale RPC-API), HomeWizard
  Energy Socket (lokale API), Tasmota-firmware (lokale HTTP/MQTT).
- Merken zonder officiële lokale API worden niet ondersteund en krijgen een melding met een alternatief.
- **Nodig van jou:** welke stekkers je hebt (merk en model).

### Apple TV (fase 4)
- Apple publiceert geen officiële API voor lokale bediening door derden. Bestaande projecten gebruiken
  reverse-engineered protocollen. Volgens de spec ("geen onbewezen protocollen") wordt dit eerst onderzocht. Is er geen
  toegestane route, dan blijft het bij een duidelijk gemarkeerde stub met uitleg, of alleen ontdekking en status via mDNS.

### Zonnepanelen en energie (fase 4)
- Een generieke energieadapter met fabrikantspecifieke bronnen. Kandidaten om te verifiëren: HomeWizard P1-meter (lokale
  API, netafname en teruglevering), Enphase (lokale gateway-API), SolarEdge (cloud monitoring-API met API-sleutel),
  SMA/Fronius (lokale API's).
- **Nodig van jou:** het merk en type van je omvormer, en of je een P1-meter hebt.

### Deurbel (fase 4)
- Alleen officiële integraties, bijvoorbeeld Google Nest via het Device Access-programma (eenmalige registratie bij Google
  vereist). Ring heeft voor zover bekend geen openbare officiële API. Dat wordt gecontroleerd.
- Snapshots alleen als de officiële API dat ondersteunt. Ze worden privé opgeslagen met een instelbare bewaartermijn.
- **Nodig van jou:** het merk en type van je deurbel.

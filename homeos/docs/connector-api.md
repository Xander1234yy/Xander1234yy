# Connector-API (v1)

Alle endpoints behalve `/health` vereisen `Authorization: Bearer <token>`. Fouten: `{ "error": { "code", "message } }`.

| Methode | Pad | Beschrijving |
| --- | --- | --- |
| GET | `/health` | Leeft de connector? (geeft geen identiteit prijs) |
| GET | `/v1/identity` | `{ connectorId, version, demoMode }` (voor de koppeling met een huishouden) |
| PUT | `/v1/rooms` | Volledige kamerlijst vervangen (bron: Supabase). Niet via de browser-proxy bereikbaar. |
| GET | `/v1/snapshot` | Connectorinfo, adapters, apparaten, kamers en scènes |
| GET | `/v1/devices/available` | Gevonden maar nog niet toegevoegde apparaten |
| POST | `/v1/discover` | Opnieuw zoeken |
| POST | `/v1/devices/:id/add` | `{ name?, roomId? }` |
| PATCH | `/v1/devices/:id` | Hernoemen of verplaatsen: `{ name?, roomId? }` |
| DELETE | `/v1/devices/:id` | Verwijderen (kan later opnieuw worden toegevoegd) |
| POST | `/v1/devices/:id/commands` | `{ command, source: "user" \| "jarvis" \| "automation" }` |
| POST | `/v1/devices/:id/sync`, `/v1/sync` | Handmatig synchroniseren |
| POST | `/v1/scenes/:id/activate` | `{ source }` |
| POST / PATCH / DELETE | `/v1/rooms`, `/v1/rooms/:id` | Kamers beheren |
| GET | `/v1/energy/summary`, `/v1/energy/history?range=day\|week\|month\|year` | Energie |
| GET | `/v1/events?limit=`, `/v1/audit?limit=` | Gebeurtenissen en auditlog |
| POST | `/v1/emergency-stop` | `{ active: boolean }` |
| WS | `/v1/ws` | Berichten van de server: `snapshot`, `event` |

Opdrachten (`DeviceCommandSchema`): `set_power`, `set_brightness`, `set_color`, `set_color_temperature`, `media`, `media_power`.

Statuscodes: 400 ongeldig · 401 token · 403 browser/verboden · 404 onbekend · 409 apparaat niet beschikbaar ·
421 host · 422 niet ondersteund · 423 noodstop · 429 rate limit · 502 adapterfout.

#!/usr/bin/env bash
# Veilige toegang tot HomeOS vanaf je telefoon/tablet via Tailscale (gratis voor persoonlijk gebruik).
# - Geen open poorten in je router: Tailscale maakt alleen uitgaande, versleutelde verbindingen.
# - Alleen jouw eigen apparaten (in jouw tailnet) kunnen HomeOS bereiken, via https met een geldig certificaat.
#
#   ./scripts/macos/remote-access.sh on      # aanzetten (https://<mac>.<tailnet>.ts.net)
#   ./scripts/macos/remote-access.sh off     # uitzetten
#   ./scripts/macos/remote-access.sh status
set -euo pipefail

TS="$(command -v tailscale || true)"
[[ -z "$TS" && -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]] && TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
if [[ -z "$TS" ]]; then
  echo "Tailscale niet gevonden. Installeer het (gratis) uit de Mac App Store of via https://tailscale.com/download," >&2
  echo "log in, en installeer Tailscale ook op je iPhone/iPad met hetzelfde account." >&2
  exit 1
fi

dns_name() { "$TS" status --json 2>/dev/null | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null || true; }

case "${1:-status}" in
  on)
    curl -fsS -o /dev/null http://127.0.0.1:3000/manifest.webmanifest || { echo "De webapp draait niet op 127.0.0.1:3000. Voer eerst uit: npm run web:install:macos" >&2; exit 1; }
    # Alleen binnen je tailnet (serve), NIET openbaar op internet (dat zou 'funnel' zijn; dat gebruiken we niet).
    "$TS" serve --bg --https=443 http://127.0.0.1:3000
    NAME="$(dns_name)"
    # Exact dit adres toestaan in de webapp (CSRF-controle), voor het geval de proxy de host niet doorgeeft.
    PLIST="$HOME/Library/LaunchAgents/nl.homeos.web.plist"
    if [[ -n "$NAME" && -f "$PLIST" ]]; then
      /usr/libexec/PlistBuddy -c "Delete :EnvironmentVariables:HOMEOS_ALLOWED_ORIGINS" "$PLIST" 2>/dev/null || true
      /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:HOMEOS_ALLOWED_ORIGINS string $NAME" "$PLIST"
      launchctl bootout "gui/$(id -u)/nl.homeos.web" 2>/dev/null || true
      launchctl bootstrap "gui/$(id -u)" "$PLIST"
    fi
    echo "✓ HomeOS is bereikbaar op je eigen apparaten via: https://${NAME:-<mac>.<tailnet>.ts.net}"
    echo "  Open dit adres in Safari op je iPhone (met Tailscale aan), vul de toegangscode in,"
    echo "  en kies Deel → Zet op beginscherm. Daarna kun je pushmeldingen aanzetten bij Instellingen."
    ;;
  off)
    "$TS" serve --https=443 off || "$TS" serve reset
    echo "✓ Toegang via Tailscale uitgezet."
    ;;
  status)
    "$TS" serve status || true
    ;;
  *)
    echo "Gebruik: $0 on|off|status" >&2
    exit 2
    ;;
esac

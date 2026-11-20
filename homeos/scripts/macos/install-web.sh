#!/usr/bin/env bash
# Installeert de HomeOS-webapp als LaunchAgent op macOS (productiebuild, alleen op 127.0.0.1:3000).
# Start automatisch bij inloggen, herstart na een crash. Nodig om HomeOS vanaf je telefoon te gebruiken.
#
# In de modus zonder accounts maakt dit script een toegangscode aan. Die is nodig zodra HomeOS van buiten
# de laptop wordt geopend (bijv. via Tailscale). Op de laptop zelf is geen code nodig.
#
#   ./scripts/macos/install-web.sh              # bouwen + installeren
#   ./scripts/macos/install-web.sh --new-code   # nieuwe toegangscode maken (oude werkt dan niet meer)
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Dit script is alleen voor macOS." >&2
  exit 1
fi

LABEL="nl.homeos.web"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WEB="$REPO/apps/web"
NODE="$(command -v node || true)"
NEXT="$REPO/node_modules/next/dist/bin/next"
DATA_DIR="${HOMEOS_DATA_DIR:-$REPO/apps/connector/.data}"
CODE_FILE="$DATA_DIR/web-access-code"
LOG_DIR="$HOME/Library/Logs/HomeOS"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

[[ -n "$NODE" ]] || { echo "Node.js niet gevonden. Installeer Node 20.9 of nieuwer." >&2; exit 1; }
[[ -f "$NEXT" ]] || { echo "Voer eerst 'npm ci' uit in $REPO." >&2; exit 1; }
[[ -f "$DATA_DIR/api-token" ]] || { echo "Start eerst de connector (npm run connector:install:macos), zodat er een connector-token is." >&2; exit 1; }

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"
umask 077

if [[ "${1:-}" == "--new-code" || ! -s "$CODE_FILE" ]]; then
  # 12 tekens uit een alfabet zonder verwarrende tekens (geen 0/O, 1/l/I).
  LC_ALL=C tr -dc 'abcdefghjkmnpqrstuvwxyz23456789' </dev/urandom | head -c 12 >"$CODE_FILE"
  chmod 600 "$CODE_FILE"
  NEW_CODE=1
fi
CODE="$(cat "$CODE_FILE")"

echo "→ Webapp bouwen (dit duurt even)…"
(cd "$WEB" && "$NODE" "$NEXT" build >/dev/null)

xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }

cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$NODE")</string>
    <string>$(xml_escape "$NEXT")</string>
    <string>start</string>
    <string>-H</string><string>127.0.0.1</string>
    <string>-p</string><string>3000</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml_escape "$WEB")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>HOMEOS_ALLOW_LOCAL_MODE</key><string>true</string>
    <key>HOMEOS_CONNECTOR_TOKEN_FILE</key><string>$(xml_escape "$DATA_DIR/api-token")</string>
    <key>HOMEOS_ACCESS_CODE</key><string>$(xml_escape "$CODE")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$(xml_escape "$LOG_DIR")/web.log</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$LOG_DIR")/web.err.log</string>
</dict>
</plist>
PLIST
chmod 600 "$PLIST" # bevat de toegangscode: alleen jouw gebruiker mag hem lezen
plutil -lint "$PLIST" >/dev/null

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "✓ HomeOS-webapp draait op http://127.0.0.1:3000 en start voortaan automatisch."
echo "  Logboek: tail -f $LOG_DIR/web.log"
if [[ -n "${NEW_CODE:-}" ]]; then
  echo
  echo "  Toegangscode voor je telefoon/tablet: $CODE"
  echo "  (Bewaard in $CODE_FILE. Nieuwe code maken: npm run web:install:macos -- --new-code)"
fi
echo
echo "Volgende stap voor je telefoon: npm run remote:on"

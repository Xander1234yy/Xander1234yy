#!/usr/bin/env bash
# Installeert de HomeOS Device Connector als LaunchAgent op macOS:
# start automatisch bij inloggen en herstart na een crash. Draait als jouw gebruiker (geen root).
#
#   ./scripts/macos/install-connector.sh            # zonder DEMO-apparaten
#   ./scripts/macos/install-connector.sh --demo     # met DEMO-apparaten
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Dit script is alleen voor macOS." >&2
  exit 1
fi

LABEL="nl.homeos.connector"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE="$(command -v node || true)"
TSX="$REPO/node_modules/tsx/dist/cli.mjs"
ENTRY="$REPO/apps/connector/src/index.ts"
DATA_DIR="${HOMEOS_DATA_DIR:-$REPO/apps/connector/.data}"
LOG_DIR="$HOME/Library/Logs/HomeOS"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DEMO="false"
[[ "${1:-}" == "--demo" ]] && DEMO="true"

[[ -n "$NODE" ]] || { echo "Node.js niet gevonden. Installeer Node 20.9 of nieuwer." >&2; exit 1; }
[[ -f "$TSX" ]] || { echo "Voer eerst 'npm install' uit in $REPO." >&2; exit 1; }

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents" "$DATA_DIR"
chmod 700 "$DATA_DIR"

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
    <string>$(xml_escape "$TSX")</string>
    <string>$(xml_escape "$ENTRY")</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml_escape "$REPO")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>HOMEOS_DEMO</key><string>$DEMO</string>
    <key>HOMEOS_DATA_DIR</key><string>$(xml_escape "$DATA_DIR")</string>
    <key>HOMEOS_CONNECTOR_HOST</key><string>127.0.0.1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$(xml_escape "$LOG_DIR")/connector.log</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$LOG_DIR")/connector.err.log</string>
</dict>
</plist>
PLIST
chmod 644 "$PLIST"
plutil -lint "$PLIST" >/dev/null

# Opnieuw laden (bootout faalt stil als hij nog niet geladen was).
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "✓ HomeOS Device Connector geïnstalleerd en gestart (DEMO=$DEMO)."
echo "  Status:   launchctl print gui/$(id -u)/$LABEL | head -20"
echo "  Logboek:  tail -f $LOG_DIR/connector.log"
echo "  Datamap:  $DATA_DIR"
echo
echo "Let op: macOS vraagt mogelijk toestemming voor 'Lokaal netwerk' (nodig voor de Hue Bridge)."
echo "Sta dit toe via Systeeminstellingen → Privacy en beveiliging → Lokaal netwerk."

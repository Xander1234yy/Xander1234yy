#!/usr/bin/env bash
# Verwijdert de LaunchAgent van de HomeOS Device Connector. De datamap (identiteit, sleutels) blijft staan.
set -euo pipefail
LABEL="nl.homeos.connector"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "✓ Connector-autostart verwijderd. Je gegevens in apps/connector/.data zijn bewaard."

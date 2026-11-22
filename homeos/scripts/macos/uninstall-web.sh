#!/usr/bin/env bash
# Verwijdert de LaunchAgent van de HomeOS-webapp.
set -euo pipefail
LABEL="nl.homeos.web"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "✓ Webapp-autostart verwijderd."

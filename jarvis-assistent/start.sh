#!/usr/bin/env bash
# Jarvis installeren en starten met één commando (Mac en Linux).
#   ./start.sh                 → web-app voor computer en telefoon (zelfde wifi)
#   ./start.sh --connector     → ook als connector voor de telefoonversie op claude.ai
#   ./start.sh <andere opties> → doorgegeven aan 'python -m jarvis web'
set -euo pipefail
cd "$(dirname "$0")"

PY=python3
command -v python3 >/dev/null 2>&1 || PY=python
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "Python 3.10 of nieuwer is nodig: https://www.python.org/downloads/" >&2
  exit 1
fi

if [ ! -d .venv ]; then
  echo "Eerste keer: Jarvis installeren…"
  "$PY" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
pip install -q -r requirements-home.txt 2>/dev/null \
  || echo "Let op: de Google Home-pakketten konden niet worden geïnstalleerd; de rest werkt wel."

# API-sleutel: uit de omgeving, uit .env, of één keer vragen
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -f .env ]; then
  set -a; . ./.env; set +a
fi
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "Maak een API-sleutel aan op https://console.anthropic.com"
  read -rsp "Plak je API-sleutel (begint met sk-ant-): " key; echo
  umask 077
  printf 'ANTHROPIC_API_KEY=%s\n' "$key" > .env
  export ANTHROPIC_API_KEY="$key"
  echo "Opgeslagen in .env (alleen leesbaar voor jou)."
fi

[ $# -eq 0 ] && set -- --telefoon
exec python -m jarvis web "$@"

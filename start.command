#!/bin/bash
# Doppelklick im Finder startet Raumplanung und öffnet den Browser.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js fehlt. Installation: https://nodejs.org (Version 20 oder neuer)"; read -r -p "Enter zum Schließen"; exit 1
fi
if [ ! -f .env ]; then cp .env.example .env; echo "Datei .env wurde angelegt. Trage dort deine zwei API-Schlüssel ein und starte noch einmal."; open -t .env; read -r -p "Enter zum Schließen"; exit 0; fi
( sleep 1; open "http://localhost:${PORT:-3000}" ) &
exec node server.js

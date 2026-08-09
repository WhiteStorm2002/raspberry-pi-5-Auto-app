#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

if [[ ! -d ".venv" ]]; then
  echo "Virtuelle Umgebung fehlt. Bitte zuerst scripts/install-pi.sh ausführen."
  exit 1
fi

source .venv/bin/activate

HOST="127.0.0.1"
PORT="8765"
URL="http://${HOST}:${PORT}"

python -m src.main --no-browser &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  kill "$CHROMIUM_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 30); do
  if curl -s "$URL/api/config" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

for cmd in chromium-browser chromium google-chrome; do
  if command -v "$cmd" >/dev/null 2>&1; then
    "$cmd" --app="$URL" --start-fullscreen --disable-infobars &
    CHROMIUM_PID=$!
    wait "$SERVER_PID"
    exit 0
  fi
done

echo "Browser nicht gefunden. Server läuft auf $URL (PID $SERVER_PID)"
wait "$SERVER_PID"

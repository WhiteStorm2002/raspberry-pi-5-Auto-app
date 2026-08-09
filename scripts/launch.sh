#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

if [[ ! -d ".venv" ]]; then
  echo "Virtuelle Umgebung fehlt. Bitte zuerst scripts/install-pi.sh ausführen."
  exit 1
fi

source .venv/bin/activate
exec python -m src.main "$@"

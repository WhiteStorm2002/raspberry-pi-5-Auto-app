#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo ""
echo "========================================"
echo "  Reise-Navi – Deinstallation"
echo "========================================"
echo ""
echo "Dieses Skript entfernt die App-Installation."
echo "Der Projektordner selbst bleibt erhalten:"
echo "  $APP_DIR"
echo ""

read -r -p "Deinstallation starten? (j/N): " CONFIRM
if [[ ! "$CONFIRM" =~ ^[jJyY]$ ]]; then
  echo "Abgebrochen."
  exit 0
fi

echo ""
echo "Entferne Startmenü-Einträge …"
rm -f "$HOME/.local/share/applications/reise-navi.desktop"
rm -f "$HOME/.local/share/applications/reise-navi-deinstallieren.desktop"

if [[ -d "$APP_DIR/.venv" ]]; then
  echo "Entferne Python-Umgebung (.venv) …"
  rm -rf "$APP_DIR/.venv"
fi

if [[ -f "$APP_DIR/config/config.yaml" ]]; then
  read -r -p "Eigene Einstellungen (config/config.yaml) löschen? (j/N): " DELETE_CONFIG
  if [[ "$DELETE_CONFIG" =~ ^[jJyY]$ ]]; then
    rm -f "$APP_DIR/config/config.yaml"
    echo "config/config.yaml gelöscht."
  else
    echo "config/config.yaml behalten."
  fi
fi

read -r -p "GPS-Daemon (gpsd) auf Werkseinstellung zurücksetzen? (j/N): " RESET_GPSD
if [[ "$RESET_GPSD" =~ ^[jJyY]$ ]]; then
  echo "Setze gpsd zurück …"
  sudo bash -c 'cat > /etc/default/gpsd << EOF
START_DAEMON="true"
DEVICES=""
GPSD_OPTIONS="-n"
EOF'
  sudo systemctl restart gpsd || true
  echo "gpsd zurückgesetzt."
fi

read -r -p "Kompletten Projektordner löschen? (j/N): " DELETE_ALL
if [[ "$DELETE_ALL" =~ ^[jJyY]$ ]]; then
  echo ""
  echo "ACHTUNG: Der gesamte Ordner wird gelöscht:"
  echo "  $APP_DIR"
  read -r -p "Wirklich alles löschen? (j/N): " DELETE_CONFIRM
  if [[ "$DELETE_CONFIRM" =~ ^[jJyY]$ ]]; then
    PARENT_DIR="$(dirname "$APP_DIR")"
    FOLDER_NAME="$(basename "$APP_DIR")"
    cd "$PARENT_DIR"
    rm -rf "$FOLDER_NAME"
    echo ""
    echo "Projektordner vollständig gelöscht."
    exit 0
  fi
fi

echo ""
echo "========================================"
echo "  Deinstallation abgeschlossen"
echo "========================================"
echo ""
echo "Entfernt:"
echo "  - Startmenü-Einträge (Reise-Navi + Deinstaller)"
echo "  - Python-Umgebung (.venv)"
echo ""
echo "Noch vorhanden:"
echo "  - Projektordner: $APP_DIR"
echo ""
echo "Neu installieren: ./scripts/install-pi.sh"
echo ""

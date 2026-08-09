#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "=== Reise-Navi Installation ==="

sudo apt update
sudo apt install -y python3 python3-venv python3-pip gpsd gpsd-clients chromium-browser

echo "GPS-Daemon konfigurieren (VK-162) …"
if ! grep -q 'DEVICES="/dev/ttyACM0"' /etc/default/gpsd 2>/dev/null; then
  sudo bash -c 'cat > /etc/default/gpsd << EOF
START_DAEMON="true"
DEVICES="/dev/ttyACM0"
GPSD_OPTIONS="-n"
EOF'
  sudo systemctl enable gpsd
  sudo systemctl restart gpsd
fi

echo "Herunterfahren ohne Passwort erlauben …"
SUDOERS_FILE="/etc/sudoers.d/reise-navi-shutdown"
if [[ ! -f "$SUDOERS_FILE" ]]; then
  echo "$USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl poweroff, /sbin/shutdown" | sudo tee "$SUDOERS_FILE" >/dev/null
  sudo chmod 440 "$SUDOERS_FILE"
fi

echo "Python-Umgebung einrichten …"
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

if [[ ! -f config/config.yaml ]]; then
  cp config/config.example.yaml config/config.yaml
  echo "config/config.yaml erstellt."
fi

chmod +x scripts/launch.sh scripts/uninstall-pi.sh DEINSTALLIEREN.sh

DESKTOP_FILE="$HOME/.local/share/applications/reise-navi.desktop"
UNINSTALL_FILE="$HOME/.local/share/applications/reise-navi-deinstallieren.desktop"
mkdir -p "$HOME/.local/share/applications"

cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Reise-Navi
Comment=Navigation mit Geschwindigkeit und Tempolimit
Exec=$APP_DIR/scripts/launch.sh
Icon=$APP_DIR/assets/icon.svg
Terminal=false
Categories=Utility;Navigation;
StartupNotify=true
EOF

cat > "$UNINSTALL_FILE" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Reise-Navi deinstallieren
Comment=Entfernt Reise-Navi vom System
Exec=$APP_DIR/scripts/uninstall-pi.sh
Icon=$APP_DIR/assets/icon-uninstall.svg
Terminal=true
Categories=Utility;
StartupNotify=true
EOF

chmod +x "$DESKTOP_FILE" "$UNINSTALL_FILE"

echo ""
echo "Installation abgeschlossen!"
echo ""
echo "App starten:"
echo "  - Desktop-Symbol: Reise-Navi"
echo "  - Terminal:       $APP_DIR/scripts/launch.sh"
echo ""
echo "Deinstallieren (nicht auf dem Desktop):"
echo "  - Startmenü:      „Reise-Navi deinstallieren“"
echo "  - Projektordner:  $APP_DIR/DEINSTALLIEREN.sh"
echo ""
echo "Nächste Schritte:"
echo "  1. GPS-Stick anschließen und Pi neu starten"
echo "  2. Reise-Navi über das Desktop-Symbol starten"

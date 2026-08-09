# Reise-Navi – Raspberry Pi 5

Dark-Mode Navigations-App für den Urlaub im Auto – **100 % kostenlos**, kein API-Key nötig.

## Features

| Feature | Beschreibung |
|---------|-------------|
| **Navigation** | Ziel eingeben, Route berechnen (OSRM), Abbiegehinweise, Ankunftszeit |
| **Geschwindigkeit** | Aktuelle km/h + Tempolimit (OpenStreetMap) |
| **Speed-Warnung** | Visuell rot pulsierend – **ohne Piepton** |
| **Favoriten** | Unterkunft, Einkauf, Parkplatz speichern und ansteuern |
| **Tankstellen / Rastplätze** | In der Nähe anzeigen und Route starten |
| **Verkehrshinweise** | Baustellen, Sperrungen, Gefahren (OSM-Daten) |
| **Uhrzeit & Wetter** | Open-Meteo, keine Registrierung |
| **Touch-UI** | Große Buttons, Dark Mode `#0044cc`, abgerundet |

## Hinweis zu Staus & Unfällen

Echte **Live-Staus wie Waze** brauchen eine kostenpflichtige oder registrierungspflichtige API.  
Reise-Navi zeigt stattdessen **OpenStreetMap-Hinweise**: Baustellen, Straßensperrungen und gemeldete Gefahren in der Nähe – kostenlos und ohne Anmeldung.

## Hardware

| Komponente | Status |
|---|---|
| Raspberry Pi 5 + Pi OS | ✅ |
| 10" Touchscreen | bestellt |
| USB GPS VK-162 | bestellt |
| WLAN / Bluetooth Stick | angeschlossen |
| Zigarettenanzünder-Netzteil | bestellt |

## Installation

```bash
git clone https://github.com/WhiteStorm2002/raspberry-pi-5-Auto-app.git
cd raspberry-pi-5-Auto-app
chmod +x scripts/*.sh DEINSTALLIEREN.sh
./scripts/install-pi.sh
```

## Bedienung

| Button | Funktion |
|--------|----------|
| **Ziel eingeben** | Adresse suchen, Navigation starten |
| **Favoriten** | Gespeicherte Orte ansteuern |
| **Hier speichern** | Aktuelle Position als Favorit |
| **Tankstellen** | ⛽ in der Nähe |
| **Rastplätze** | 🅿️ in der Nähe |

## Deinstallieren

| Wo | Was |
|---|---|
| Startmenü | „Reise-Navi deinstallieren“ |
| Projektordner | `DEINSTALLIEREN.sh` |

## Testen am PC

```yaml
# config/config.yaml
gps:
  simulate: true
```

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp config/config.example.yaml config/config.yaml
python -m src.main
```

## Lizenz

Siehe [LICENSE](LICENSE).

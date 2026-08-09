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

## Update (für bestehende Installation)

Wenn du bereits eine ältere Version installiert hast und auf die **neueste Version** updaten willst:

```bash
cd ~/raspberry-pi-5-Auto-app

# Lokale Änderungen an Skripten verwerfen (behebt git-pull-Fehler)
git restore scripts/install-pi.sh scripts/launch.sh

# Falls „git restore" nicht verfügbar ist (älteres Git):
# git checkout -- scripts/install-pi.sh scripts/launch.sh

# Neueste Version von GitHub holen
git pull

# Abhängigkeiten & Desktop-Einträge aktualisieren
chmod +x scripts/*.sh DEINSTALLIEREN.sh
./scripts/install-pi.sh
```

**Hinweise zum Update:**
- Deine **Einstellungen** (`config/config.yaml`) und **Favoriten** (`data/favorites.json`) bleiben erhalten
- Die App danach wie gewohnt über das Desktop-Symbol **Reise-Navi** starten
- Bei Fehlermeldungen beim Pull: zuerst `git restore` ausführen, dann erneut `git pull`

**Typische Fehlermeldung ohne `git restore`:**
```
Fehler: Ihre lokalen Änderungen in den folgenden Dateien würden durch den Merge überschrieben werden:
  scripts/install-pi.sh
  scripts/launch.sh
```
→ Dann die Befehle oben der Reihe nach ausführen.

## Schlüsselbund-Passwort beim Start?

Nach einem **Pi-Neustart** kann Chromium nach dem **Schlüsselbund-Passwort** fragen. Das ist der **GNOME-Schlüsselbund** — gedacht für gespeicherte Browser-Passwörter.

**Reise-Navi braucht das nicht.** Ab Version mit `--password-store=basic` sollte die Abfrage weg sein.

Falls sie noch erscheint, nach `git pull` einmal manuell in `scripts/launch.sh` prüfen, dass `--password-store=basic` beim Chromium-Start gesetzt ist.

## Bedienung

| Button | Funktion |
|--------|----------|
| **Ziel wählen** | Ziel-Dialog (Karte oder optional Tastatur) |
| **Ziel auf Karte** | Direkt auf der Karte antippen – **ohne Tastatur** |
| **Favoriten** | Gespeicherte Orte ansteuern (Hotel, Einkauf …) |
| **Hier speichern** | Aktuelle Position als Favorit merken |
| **Tankstellen** | ⛽ in der Nähe (als Zwischenstopp möglich) |
| **Rastplätze** | 🅿️ in der Nähe |

### Ziel ohne Tastatur (im Auto)

1. **Ziel auf Karte** tippen → Ort auf der Karte berühren → **Navigation starten**
2. Oder **Favoriten** nutzen (Hotel etc. vorher einmal speichern)
3. Optional: **Tankstelle/Rastplatz** als Zwischenstopp antippen

Tipp: Speichere Unterkunft und häufige Ziele als **Favoriten**, wenn du noch eine Tastatur angeschlossen hast – im Urlaub reicht dann ein Tipp.

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

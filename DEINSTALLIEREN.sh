#!/usr/bin/env bash
# Deinstaller – im Projektordner leicht zu finden (nicht auf dem Desktop)
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/uninstall-pi.sh"

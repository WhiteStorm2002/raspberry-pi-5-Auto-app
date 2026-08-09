from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

import uvicorn

from src.config_loader import load_config


def open_browser_window(url: str) -> None:
    """Öffnet die App in einem Chromium-Fenster (typisch auf Raspberry Pi OS)."""
    candidates = [
        [
            "chromium-browser",
            f"--app={url}",
            "--start-fullscreen",
            "--disable-infobars",
            "--password-store=basic",
            "--no-first-run",
        ],
        [
            "chromium",
            f"--app={url}",
            "--start-fullscreen",
            "--disable-infobars",
            "--password-store=basic",
            "--no-first-run",
        ],
        ["google-chrome", f"--app={url}", "--start-fullscreen"],
    ]

    for command in candidates:
        try:
            subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except FileNotFoundError:
            continue

    print(f"Browser nicht gefunden. Bitte manuell öffnen: {url}")


def main() -> None:
    config = load_config()
    server = config.get("server", {})
    host = server.get("host", "127.0.0.1")
    port = int(server.get("port", 8765))
    url = f"http://{host}:{port}"

    if "--no-browser" not in sys.argv:
        import threading

        def delayed_open() -> None:
            time.sleep(1.5)
            open_browser_window(url)

        threading.Thread(target=delayed_open, daemon=True).start()

    uvicorn.run(
        "src.api.app:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()

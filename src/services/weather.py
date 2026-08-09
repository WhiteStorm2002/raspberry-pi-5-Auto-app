from __future__ import annotations

import time
from typing import Any

import httpx


class WeatherService:
    """Open-Meteo – kostenlos, ohne Registrierung."""

    API_URL = "https://api.open-meteo.com/v1/forecast"

    def __init__(self, config: dict | None = None) -> None:
        config = config or {}
        self._cache_seconds = int(config.get("cache_seconds", 600))
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}

    async def get_current(self, latitude: float, longitude: float) -> dict[str, Any]:
        cache_key = f"{latitude:.2f},{longitude:.2f}"
        now = time.time()

        cached = self._cache.get(cache_key)
        if cached and now - cached[0] < self._cache_seconds:
            return cached[1]

        params = {
            "latitude": latitude,
            "longitude": longitude,
            "current": "temperature_2m,weather_code",
            "timezone": "auto",
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(self.API_URL, params=params)
                response.raise_for_status()
                data = response.json()
        except Exception:
            return {"temperature_c": None, "description": "Nicht verfügbar"}

        current = data.get("current", {})
        code = current.get("weather_code")
        result = {
            "temperature_c": current.get("temperature_2m"),
            "weather_code": code,
            "description": self._weather_label(code),
            "timezone": data.get("timezone"),
        }

        self._cache[cache_key] = (now, result)
        return result

    @staticmethod
    def _weather_label(code: int | None) -> str:
        if code is None:
            return "—"
        if code == 0:
            return "Klar"
        if code in (1, 2, 3):
            return "Bewölkt"
        if code in (45, 48):
            return "Nebel"
        if code in (51, 53, 55, 61, 63, 65, 80, 81, 82):
            return "Regen"
        if code in (71, 73, 75, 85, 86):
            return "Schnee"
        if code in (95, 96, 99):
            return "Gewitter"
        return "Wechselhaft"

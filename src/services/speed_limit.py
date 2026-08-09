from __future__ import annotations

import re
import time
from typing import Any

import httpx


class SpeedLimitService:
    """Ermittelt erlaubte Höchstgeschwindigkeit über OpenStreetMap."""

    OVERPASS_URL = "https://overpass-api.de/api/interpreter"

    def __init__(self, config: dict) -> None:
        self._radius = int(config.get("query_radius_m", 50))
        self._cache_seconds = int(config.get("cache_seconds", 30))
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}

    async def lookup(self, latitude: float, longitude: float) -> dict[str, Any]:
        cache_key = f"{latitude:.4f},{longitude:.4f}"
        now = time.time()

        cached = self._cache.get(cache_key)
        if cached and now - cached[0] < self._cache_seconds:
            return cached[1]

        result = await self._query_overpass(latitude, longitude)
        self._cache[cache_key] = (now, result)
        return result

    async def _query_overpass(self, latitude: float, longitude: float) -> dict[str, Any]:
        query = f"""
        [out:json][timeout:10];
        way(around:{self._radius},{latitude},{longitude})["highway"]["maxspeed"];
        out tags 1;
        """

        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                response = await client.post(self.OVERPASS_URL, data={"data": query})
                response.raise_for_status()
                data = response.json()
        except Exception:
            return {"limit_kmh": None, "road_name": None, "source": "unavailable"}

        elements = data.get("elements", [])
        if not elements:
            return {"limit_kmh": None, "road_name": None, "source": "not_found"}

        tags = elements[0].get("tags", {})
        limit = self._parse_maxspeed(tags.get("maxspeed"))

        return {
            "limit_kmh": limit,
            "road_name": tags.get("name"),
            "highway": tags.get("highway"),
            "source": "openstreetmap",
        }

    @staticmethod
    def _parse_maxspeed(value: str | None) -> int | None:
        if not value:
            return None

        if value.startswith("DE:"):
            defaults = {
                "DE:motorway": 130,
                "DE:rural": 100,
                "DE:urban": 50,
                "DE:living_street": 7,
            }
            return defaults.get(value)

        match = re.search(r"(\d+)", value)
        if match:
            return int(match.group(1))

        return None

from __future__ import annotations

import time
from typing import Any

import httpx


class PoiService:
    """Tankstellen und Rastplätze über OpenStreetMap."""

    OVERPASS_URL = "https://overpass-api.de/api/interpreter"

    QUERIES = {
        "fuel": """
            node(around:{radius},{lat},{lon})["amenity"="fuel"];
            way(around:{radius},{lat},{lon})["amenity"="fuel"];
        """,
        "rest": """
            node(around:{radius},{lat},{lon})["highway"="rest_area"];
            node(around:{radius},{lat},{lon})["highway"="services"];
            way(around:{radius},{lat},{lon})["highway"="rest_area"];
            way(around:{radius},{lat},{lon})["highway"="services"];
        """,
    }

    def __init__(self, config: dict | None = None) -> None:
        config = config or {}
        self._radius = int(config.get("radius_m", 8000))
        self._cache_seconds = int(config.get("cache_seconds", 120))
        self._cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}

    async def nearby(self, latitude: float, longitude: float, poi_type: str) -> list[dict[str, Any]]:
        if poi_type not in self.QUERIES:
            return []

        cache_key = f"{poi_type}:{latitude:.3f},{longitude:.3f}"
        now = time.time()
        cached = self._cache.get(cache_key)
        if cached and now - cached[0] < self._cache_seconds:
            return cached[1]

        query_body = self.QUERIES[poi_type].format(
            radius=self._radius, lat=latitude, lon=longitude
        )
        query = f"[out:json][timeout:15];({query_body});out center 20;"

        try:
            async with httpx.AsyncClient(timeout=18.0) as client:
                response = await client.post(self.OVERPASS_URL, data={"data": query})
                response.raise_for_status()
                data = response.json()
        except Exception:
            return []

        results = []
        for element in data.get("elements", []):
            lat = element.get("lat") or (element.get("center") or {}).get("lat")
            lon = element.get("lon") or (element.get("center") or {}).get("lon")
            if lat is None or lon is None:
                continue

            tags = element.get("tags", {})
            name = tags.get("name") or tags.get("brand") or ("Tankstelle" if poi_type == "fuel" else "Rastplatz")
            results.append(
                {
                    "name": name,
                    "lat": lat,
                    "lon": lon,
                    "type": poi_type,
                    "operator": tags.get("operator"),
                }
            )

        self._cache[cache_key] = (now, results)
        return results

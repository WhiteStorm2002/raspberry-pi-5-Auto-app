from __future__ import annotations

import time
from typing import Any

import httpx

OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


class PoiService:
    """Tankstellen und Rastplätze über OpenStreetMap."""

    def __init__(self, config: dict | None = None) -> None:
        config = config or {}
        self._radius = int(config.get("radius_m", 10000))
        self._cache_seconds = int(config.get("cache_seconds", 120))
        self._cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}

    async def nearby(self, latitude: float, longitude: float, poi_type: str) -> list[dict[str, Any]]:
        if poi_type not in ("fuel", "rest"):
            return []

        cache_key = f"{poi_type}:{latitude:.3f},{longitude:.3f}"
        now = time.time()
        cached = self._cache.get(cache_key)
        if cached and now - cached[0] < self._cache_seconds:
            return cached[1]

        query = self._build_query(poi_type, latitude, longitude)
        data = await self._run_overpass(query)
        if data is None:
            return []

        results: list[dict[str, Any]] = []
        seen: set[str] = set()

        for element in data.get("elements", []):
            lat = element.get("lat") or (element.get("center") or {}).get("lat")
            lon = element.get("lon") or (element.get("center") or {}).get("lon")
            if lat is None or lon is None:
                continue

            key = f"{lat:.5f},{lon:.5f}"
            if key in seen:
                continue
            seen.add(key)

            tags = element.get("tags", {})
            default_name = "Tankstelle" if poi_type == "fuel" else "Rastplatz"
            name = tags.get("name") or tags.get("brand") or tags.get("operator") or default_name
            results.append(
                {
                    "name": name,
                    "lat": lat,
                    "lon": lon,
                    "type": poi_type,
                    "operator": tags.get("operator"),
                }
            )

        results.sort(
            key=lambda item: self._approx_distance(latitude, longitude, item["lat"], item["lon"])
        )
        self._cache[cache_key] = (now, results[:25])
        return results[:25]

    def _build_query(self, poi_type: str, lat: float, lon: float) -> str:
        r = self._radius
        if poi_type == "fuel":
            body = f"""
              node(around:{r},{lat},{lon})["amenity"="fuel"];
              way(around:{r},{lat},{lon})["amenity"="fuel"];
              relation(around:{r},{lat},{lon})["amenity"="fuel"];
            """
        else:
            body = f"""
              node(around:{r},{lat},{lon})["highway"="rest_area"];
              node(around:{r},{lat},{lon})["highway"="services"];
              way(around:{r},{lat},{lon})["highway"="rest_area"];
              way(around:{r},{lat},{lon})["highway"="services"];
            """

        return f"[out:json][timeout:25];({body});out center 25;"

    async def _run_overpass(self, query: str) -> dict[str, Any] | None:
        for url in OVERPASS_SERVERS:
            try:
                async with httpx.AsyncClient(timeout=28.0) as client:
                    response = await client.post(url, data={"data": query})
                    response.raise_for_status()
                    return response.json()
            except Exception:
                continue
        return None

    @staticmethod
    def _approx_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> int:
        from math import cos, radians, sqrt

        x = (lon2 - lon1) * cos(radians((lat1 + lat2) / 2))
        y = lat2 - lat1
        return int(sqrt(x * x + y * y) * 111_000)

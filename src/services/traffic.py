from __future__ import annotations

import time
from typing import Any

import httpx


class TrafficService:
    """
    Verkehrshinweise aus OpenStreetMap (Community-Daten).
    Kein Live-Datenfeed wie Waze – zeigt Baustellen, Sperrungen und gemeldete Gefahren.
    """

    OVERPASS_URL = "https://overpass-api.de/api/interpreter"

    def __init__(self, config: dict | None = None) -> None:
        config = config or {}
        self._radius = int(config.get("radius_m", 15000))
        self._cache_seconds = int(config.get("cache_seconds", 90))
        self._cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}

    async def warnings(self, latitude: float, longitude: float) -> list[dict[str, Any]]:
        cache_key = f"{latitude:.3f},{longitude:.3f}"
        now = time.time()
        cached = self._cache.get(cache_key)
        if cached and now - cached[0] < self._cache_seconds:
            return cached[1]

        query = f"""
        [out:json][timeout:15];
        (
          node(around:{self._radius},{latitude},{longitude})["hazard"];
          way(around:{self._radius},{latitude},{longitude})["construction"];
          way(around:{self._radius},{latitude},{longitude})["highway"="construction"];
          way(around:{self._radius},{latitude},{longitude})["access"="no"]["highway"~"motorway|trunk|primary"];
          node(around:{self._radius},{latitude},{longitude})["traffic_sign"~"DE:123|DE:125"];
        );
        out center 15;
        """

        try:
            async with httpx.AsyncClient(timeout=18.0) as client:
                response = await client.post(self.OVERPASS_URL, data={"data": query})
                response.raise_for_status()
                data = response.json()
        except Exception:
            return []

        warnings: list[dict[str, Any]] = []
        seen: set[str] = set()

        for element in data.get("elements", []):
            tags = element.get("tags", {})
            lat = element.get("lat") or (element.get("center") or {}).get("lat")
            lon = element.get("lon") or (element.get("center") or {}).get("lon")

            warning = self._build_warning(tags)
            if not warning:
                continue

            key = f"{warning['type']}:{warning['message']}"
            if key in seen:
                continue
            seen.add(key)

            if lat is not None and lon is not None:
                warning["lat"] = lat
                warning["lon"] = lon
                warning["distance_m"] = self._approx_distance(latitude, longitude, lat, lon)

            warnings.append(warning)

        warnings.sort(key=lambda item: item.get("distance_m", 999999))
        self._cache[cache_key] = (now, warnings[:10])
        return warnings[:10]

    def _build_warning(self, tags: dict) -> dict[str, Any] | None:
        if tags.get("hazard"):
            return {
                "type": "hazard",
                "severity": "high",
                "message": f"Gefahrenstelle: {tags['hazard']}",
            }

        if tags.get("construction") or tags.get("highway") == "construction":
            desc = tags.get("description") or tags.get("construction") or "Baustelle"
            return {"type": "construction", "severity": "medium", "message": f"Baustelle: {desc}"}

        if tags.get("access") == "no" and tags.get("highway") in ("motorway", "trunk", "primary"):
            name = tags.get("name") or tags.get("ref") or "Straße"
            return {"type": "closure", "severity": "high", "message": f"Sperrung: {name}"}

        if "traffic_sign" in tags:
            return {"type": "traffic", "severity": "medium", "message": "Verkehrshinweis in der Nähe"}

        return None

    @staticmethod
    def _approx_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> int:
        from math import cos, radians, sqrt

        x = (lon2 - lon1) * cos(radians((lat1 + lat2) / 2))
        y = lat2 - lat1
        return int(sqrt(x * x + y * y) * 111_000)

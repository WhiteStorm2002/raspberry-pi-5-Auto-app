from __future__ import annotations

import httpx

OSRM_BASE = "https://router.project-osrm.org"

MANEUVER_DE = {
    "turn": "Abbiegen",
    "new name": "Weiterfahren",
    "depart": "Start",
    "arrive": "Ziel erreicht",
    "merge": "Einfädeln",
    "ramp": "Auffahrt",
    "on ramp": "Auffahrt nehmen",
    "off ramp": "Ausfahrt nehmen",
    "fork": "Gabelung",
    "end of road": "Ende der Straße",
    "continue": "Geradeaus",
    "roundabout": "Kreisverkehr",
    "rotary": "Kreisverkehr",
    "roundabout turn": "Kreisverkehr",
}


def _translate_modifier(modifier: str | None) -> str:
    if not modifier:
        return ""
    mapping = {
        "left": "links",
        "right": "rechts",
        "straight": "geradeaus",
        "slight left": "leicht links",
        "slight right": "leicht rechts",
        "sharp left": "scharf links",
        "sharp right": "scharf rechts",
        "uturn": "wenden",
    }
    return mapping.get(modifier, modifier)


def _format_step(step: dict) -> str:
    maneuver = step.get("maneuver", {})
    m_type = maneuver.get("type", "")
    modifier = _translate_modifier(maneuver.get("modifier"))
    name = step.get("name") or ""

    base = MANEUVER_DE.get(m_type, "Weiter")
    if modifier:
        base = f"{base} {modifier}"
    if name:
        return f"{base} – {name}"
    return base


class RoutingService:
    def __init__(self, config: dict | None = None) -> None:
        config = config or {}
        self._base_url = config.get("osrm_url", OSRM_BASE).rstrip("/")

    async def calculate(
        self,
        from_lat: float,
        from_lon: float,
        to_lat: float,
        to_lon: float,
        waypoints: list[tuple[float, float]] | None = None,
    ) -> dict:
        points: list[tuple[float, float]] = [(from_lon, from_lat)]
        if waypoints:
            points.extend((lon, lat) for lat, lon in waypoints)
        points.append((to_lon, to_lat))

        coords = ";".join(f"{lon},{lat}" for lon, lat in points)
        url = (
            f"{self._base_url}/route/v1/driving/{coords}"
            "?steps=true&geometries=geojson&overview=full&annotations=true"
        )

        async with httpx.AsyncClient(timeout=25.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

        if data.get("code") != "Ok" or not data.get("routes"):
            return {"error": "Route nicht gefunden"}

        route = data["routes"][0]
        steps = []

        for leg in route.get("legs", []):
            for step in leg.get("steps", []):
                maneuver = step.get("maneuver", {})
                loc = maneuver.get("location", [])
                steps.append(
                    {
                        "instruction": _format_step(step),
                        "distance_m": round(step.get("distance", 0)),
                        "duration_s": round(step.get("duration", 0)),
                        "lon": loc[0] if len(loc) > 0 else None,
                        "lat": loc[1] if len(loc) > 1 else None,
                        "type": maneuver.get("type"),
                        "modifier": maneuver.get("modifier"),
                    }
                )

        return {
            "distance_m": round(route.get("distance", 0)),
            "duration_s": round(route.get("duration", 0)),
            "geometry": route.get("geometry"),
            "steps": steps,
            "destination": {"lat": to_lat, "lon": to_lon},
            "waypoint_count": len(waypoints or []),
        }

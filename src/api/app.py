from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from src.config_loader import load_config
from src.gps.reader import GpsReader
from src.services.favorites import FavoritesService
from src.services.poi import PoiService
from src.services.routing import RoutingService
from src.services.speed_limit import SpeedLimitService
from src.services.traffic import TrafficService
from src.services.weather import WeatherService

ROOT_DIR = Path(__file__).resolve().parents[2]
STATIC_DIR = Path(__file__).resolve().parents[1] / "static"

config = load_config()
gps_reader = GpsReader(config.get("gps", {}))
speed_limit_service = SpeedLimitService(config.get("speed_limit", {}))
routing_service = RoutingService(config.get("routing", {}))
weather_service = WeatherService(config.get("weather", {}))
poi_service = PoiService(config.get("poi", {}))
traffic_service = TrafficService(config.get("traffic", {}))
favorites_service = FavoritesService(
    ROOT_DIR / config.get("favorites", {}).get("file", "data/favorites.json")
)

app = FastAPI(title="Reise-Navi", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

_speed_warning_tolerance = int(config.get("speed_warning", {}).get("tolerance_kmh", 5))


class RouteRequest(BaseModel):
    from_lat: float
    from_lon: float
    to_lat: float
    to_lon: float


class FavoriteRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    lat: float
    lon: float
    category: str = "other"


@app.on_event("startup")
async def startup() -> None:
    asyncio.create_task(gps_reader.run())


@app.on_event("shutdown")
async def shutdown() -> None:
    gps_reader.stop()


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/config")
async def get_public_config() -> dict[str, Any]:
    ui = config.get("ui", {})
    maps = config.get("maps", {})
    return {
        "accent_color": ui.get("accent_color", "#0044cc"),
        "border_radius": ui.get("border_radius", 16),
        "window_title": ui.get("window_title", "Reise-Navi"),
        "tile_provider": maps.get("tile_provider", "carto_dark"),
        "default_zoom": maps.get("default_zoom", 15),
        "default_lat": maps.get("default_lat", 48.137154),
        "default_lon": maps.get("default_lon", 11.576124),
        "speed_warning_tolerance": _speed_warning_tolerance,
        "favorite_categories": list(FavoritesService.CATEGORIES),
    }


async def build_status_payload() -> dict[str, Any]:
    fix = gps_reader.latest
    payload: dict[str, Any] = {
        "gps": fix.to_dict(),
        "speed_limit": None,
        "weather": None,
        "traffic": [],
        "speed_warning": False,
        "server_time": datetime.now(timezone.utc).isoformat(),
    }

    if fix.has_fix and fix.latitude is not None and fix.longitude is not None:
        lat, lon = fix.latitude, fix.longitude
        payload["speed_limit"] = await speed_limit_service.lookup(lat, lon)
        payload["weather"] = await weather_service.get_current(lat, lon)
        payload["traffic"] = await traffic_service.warnings(lat, lon)

        limit = payload["speed_limit"] or {}
        if (
            fix.speed_kmh is not None
            and limit.get("limit_kmh") is not None
            and fix.speed_kmh > limit["limit_kmh"] + _speed_warning_tolerance
        ):
            payload["speed_warning"] = True

    return payload


@app.get("/api/status")
async def get_status() -> dict[str, Any]:
    return await build_status_payload()


@app.post("/api/route")
async def calculate_route(body: RouteRequest) -> dict[str, Any]:
    result = await routing_service.calculate(
        body.from_lat, body.from_lon, body.to_lat, body.to_lon
    )
    if result.get("error"):
        raise HTTPException(status_code=404, detail=result["error"])

    eta = datetime.now(timezone.utc) + timedelta(seconds=result["duration_s"])
    result["eta"] = eta.isoformat()
    result["eta_local"] = eta.astimezone().strftime("%H:%M")
    result["distance_km"] = round(result["distance_m"] / 1000, 1)
    result["duration_min"] = round(result["duration_s"] / 60)
    return result


@app.get("/api/poi/{poi_type}")
async def get_poi(poi_type: str, lat: float, lon: float) -> dict[str, Any]:
    if poi_type not in ("fuel", "rest"):
        raise HTTPException(status_code=400, detail="Typ muss 'fuel' oder 'rest' sein")
    items = await poi_service.nearby(lat, lon, poi_type)
    return {"type": poi_type, "items": items}


@app.get("/api/favorites")
async def get_favorites() -> dict[str, Any]:
    return {"items": favorites_service.list_all()}


@app.post("/api/favorites")
async def add_favorite(body: FavoriteRequest) -> dict[str, Any]:
    entry = favorites_service.add(body.name, body.lat, body.lon, body.category)
    return {"item": entry}


@app.delete("/api/favorites/{item_id}")
async def delete_favorite(item_id: str) -> dict[str, Any]:
    if not favorites_service.delete(item_id):
        raise HTTPException(status_code=404, detail="Favorit nicht gefunden")
    return {"ok": True}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(await build_status_payload())
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass

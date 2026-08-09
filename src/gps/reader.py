from __future__ import annotations

import asyncio
import math
import random
import time
from datetime import datetime, timezone

import pynmea2
import serial

from src.gps import GpsFix

try:
    from gps import gps as gpsd_module

    HAS_GPSD = True
except ImportError:
    HAS_GPSD = False


class GpsReader:
    """Liest GPS-Daten vom VK-162 (gpsd oder direkt per Serial)."""

    def __init__(self, config: dict) -> None:
        self._config = config
        self._latest = GpsFix()
        self._running = False

    @property
    def latest(self) -> GpsFix:
        return self._latest

    async def run(self) -> None:
        self._running = True
        if self._config.get("simulate"):
            await self._run_simulation()
            return

        source = self._config.get("source", "gpsd")
        if source == "gpsd":
            await self._run_gpsd()
        else:
            await self._run_serial()

    def stop(self) -> None:
        self._running = False

    async def _run_gpsd(self) -> None:
        if not HAS_GPSD:
            self._latest.fix_quality = "error"
            return

        session = gpsd_module(mode=gpsd_module.WATCH_ENABLE)

        while self._running:
            try:
                report = session.next()
                if report["class"] == "TPV":
                    self._latest = self._fix_from_tpv(report)
            except Exception:
                self._latest.fix_quality = "searching"
            await asyncio.sleep(0.2)

    async def _run_serial(self) -> None:
        device = self._config.get("device", "/dev/ttyACM0")
        baudrate = int(self._config.get("baudrate", 9600))

        while self._running:
            try:
                with serial.Serial(device, baudrate, timeout=1) as port:
                    self._latest.fix_quality = "searching"
                    while self._running:
                        line = port.readline().decode("ascii", errors="ignore").strip()
                        if not line.startswith("$"):
                            continue
                        self._apply_nmea(line)
                        await asyncio.sleep(0)
            except Exception:
                self._latest.fix_quality = "error"
                await asyncio.sleep(2)

    async def _run_simulation(self) -> None:
        lat, lon = 48.137154, 11.576124
        speed = 50.0
        heading = 90.0

        while self._running:
            lat += 0.00008
            lon += 0.00005
            speed = max(0, speed + random.uniform(-2, 2))
            heading = (heading + random.uniform(-5, 5)) % 360

            self._latest = GpsFix(
                latitude=round(lat, 6),
                longitude=round(lon, 6),
                speed_kmh=round(speed, 1),
                heading=round(heading, 1),
                altitude_m=520.0,
                satellites=8,
                fix_quality="3d",
                timestamp=datetime.now(timezone.utc).isoformat(),
            )
            await asyncio.sleep(1)

    def _apply_nmea(self, line: str) -> None:
        try:
            msg = pynmea2.parse(line)
        except pynmea2.ParseError:
            return

        if isinstance(msg, pynmea2.types.talker.RMC):
            if msg.status == "A":
                self._latest.latitude = msg.latitude
                self._latest.longitude = msg.longitude
                self._latest.speed_kmh = msg.spd_over_grnd * 1.852 if msg.spd_over_grnd else 0.0
                self._latest.heading = msg.true_course
                self._latest.fix_quality = "3d"
                self._latest.timestamp = datetime.now(timezone.utc).isoformat()
        elif isinstance(msg, pynmea2.types.talker.GGA):
            self._latest.altitude_m = msg.altitude
            self._latest.satellites = int(msg.num_sats) if msg.num_sats else 0
            if msg.gps_qual and int(msg.gps_qual) > 0:
                self._latest.fix_quality = "3d" if int(msg.gps_qual) >= 2 else "2d"

    @staticmethod
    def _fix_from_tpv(report: dict) -> GpsFix:
        mode = report.get("mode", 0)
        quality = {0: "none", 1: "none", 2: "2d", 3: "3d"}.get(mode, "searching")
        speed_ms = report.get("speed")
        speed_kmh = round(speed_ms * 3.6, 1) if speed_ms is not None and not math.isnan(speed_ms) else None

        return GpsFix(
            latitude=report.get("lat"),
            longitude=report.get("lon"),
            speed_kmh=speed_kmh,
            heading=report.get("track"),
            altitude_m=report.get("alt"),
            fix_quality=quality,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

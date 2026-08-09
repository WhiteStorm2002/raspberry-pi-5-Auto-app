from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any


@dataclass
class GpsFix:
    latitude: float | None = None
    longitude: float | None = None
    speed_kmh: float | None = None
    heading: float | None = None
    altitude_m: float | None = None
    satellites: int | None = None
    fix_quality: str = "none"
    timestamp: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def has_fix(self) -> bool:
        return self.latitude is not None and self.longitude is not None

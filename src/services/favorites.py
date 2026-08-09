from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class FavoritesService:
    CATEGORIES = ("hotel", "shop", "park", "other")

    def __init__(self, file_path: Path) -> None:
        self._path = file_path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._save([])

    def list_all(self) -> list[dict[str, Any]]:
        return self._load()

    def add(
        self,
        name: str,
        lat: float,
        lon: float,
        category: str = "other",
    ) -> dict[str, Any]:
        if category not in self.CATEGORIES:
            category = "other"

        entry = {
            "id": str(uuid.uuid4())[:8],
            "name": name.strip(),
            "category": category,
            "lat": lat,
            "lon": lon,
            "created": datetime.now(timezone.utc).isoformat(),
        }

        items = self._load()
        items.append(entry)
        self._save(items)
        return entry

    def delete(self, item_id: str) -> bool:
        items = self._load()
        filtered = [item for item in items if item["id"] != item_id]
        if len(filtered) == len(items):
            return False
        self._save(filtered)
        return True

    def _load(self) -> list[dict[str, Any]]:
        try:
            with self._path.open(encoding="utf-8") as handle:
                return json.load(handle)
        except (json.JSONDecodeError, FileNotFoundError):
            return []

    def _save(self, items: list[dict[str, Any]]) -> None:
        with self._path.open("w", encoding="utf-8") as handle:
            json.dump(items, handle, indent=2, ensure_ascii=False)

from __future__ import annotations

from pathlib import Path

import yaml


def load_config() -> dict:
    root = Path(__file__).resolve().parents[1]
    config_path = root / "config" / "config.yaml"
    example_path = root / "config" / "config.example.yaml"

    path = config_path if config_path.exists() else example_path
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle)

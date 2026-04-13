from __future__ import annotations

from pathlib import Path
from typing import Any
import json

BASE_DIR = Path(__file__).resolve().parent.parent / "data"


def load_json(filename: str) -> Any:
    path = BASE_DIR / filename
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)

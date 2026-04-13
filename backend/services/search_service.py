from __future__ import annotations

from typing import Any, Dict, List, Optional
import re

from services.data_loader import load_json


class SearchService:
    """
    IF Maker v0 search engine.

    Responsibilities:
    1. Load materials / objects from local JSON files
    2. Search by name, tags, summary, uses
    3. Filter by category if provided
    4. Return lightweight search cards
    """

    def __init__(self) -> None:
        self.materials: List[Dict[str, Any]] = load_json("materials.json")
        self.objects: List[Dict[str, Any]] = load_json("objects.json")
        try:
            self.elements: List[Dict[str, Any]] = load_json("elements.json")
        except FileNotFoundError:
            self.elements = []
        # User-created materials persist only in process memory.
        self.user_items: List[Dict[str, Any]] = []
        self.items: List[Dict[str, Any]] = (
            self.materials + self.objects + self.elements + self.user_items
        )

    def add_user_item(self, item: Dict[str, Any]) -> None:
        self.user_items.append(item)
        self.items.append(item)

    def search(
        self,
        q: str = "",
        category: Optional[str] = None,
        group: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        q_norm = self._normalize_text(q)
        results: List[Dict[str, Any]] = []

        for item in self.items:
            if category and item.get("category") != category:
                continue
            if group and item.get("group") != group:
                continue

            if not q_norm:
                results.append(self._to_search_card(item))
                continue

            if self._matches(item, q_norm):
                results.append(self._to_search_card(item))

        results.sort(key=lambda x: x["name"].lower())
        return results

    def list_groups(self) -> List[Dict[str, Any]]:
        counts: Dict[str, Dict[str, Any]] = {}
        for item in self.items:
            g = item.get("group")
            if not g:
                continue
            entry = counts.setdefault(
                g,
                {"group": g, "category": item["category"], "count": 0},
            )
            entry["count"] += 1
        return sorted(counts.values(), key=lambda x: (x["category"], x["group"]))

    def get_item_by_id(self, item_id: str) -> Optional[Dict[str, Any]]:
        for item in self.items:
            if item.get("id") == item_id:
                return item
        return None

    def _matches(self, item: Dict[str, Any], q_norm: str) -> bool:
        searchable_fields: List[str] = []
        searchable_fields.append(item.get("name", ""))
        searchable_fields.append(item.get("summary", ""))
        searchable_fields.extend(item.get("tags", []))
        searchable_fields.extend(item.get("uses", []))

        combined = " ".join(str(x) for x in searchable_fields)
        combined_norm = self._normalize_text(combined)

        return q_norm in combined_norm

    def _to_search_card(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": item.get("id"),
            "name": item.get("name"),
            "category": item.get("category"),
            "group": item.get("group"),
            "emoji": item.get("emoji"),
            "shape": item.get("shape"),
            "summary": item.get("summary"),
            "tags": item.get("tags", []),
        }

    @staticmethod
    def _normalize_text(text: str) -> str:
        text = text.lower().strip()
        text = re.sub(r"\s+", " ", text)
        return text

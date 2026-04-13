from __future__ import annotations

from typing import Any, Dict, List, Optional
import hashlib
import re


class ExportService:
    """
    Exporters for synthesis results.

    Unity / Unreal / engine-agnostic JSON schemas. No file IO — just pure
    transforms. Routes are responsible for HTTP responses.
    """

    # ------------------------------------------------------------ Unity

    def to_unity_scriptable_object(
        self, items: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Produces a shape that maps cleanly onto Unity's ScriptableObject
        conventions. The consumer can drop this JSON into a generated
        `ItemRecipe.asset` importer.
        """
        recipes = []
        for item in items:
            props = item.get("properties") or item.get("combined_properties") or {}
            parts = self._extract_parts(item)
            recipes.append(
                {
                    "assetGuid": self._stable_guid(item.get("id", "")),
                    "itemId": item.get("id"),
                    "displayName": item.get("name")
                    or item.get("concept_name")
                    or "Untitled",
                    "category": item.get("category", "material"),
                    "group": item.get("group", "unknown"),
                    "rarity": self._infer_rarity(props),
                    "stats": {
                        "strength": int(props.get("strength", 5) or 5),
                        "durability": int(props.get("heat_resistance", 5) or 5),
                        "weight": int(props.get("weight", 5) or 5),
                        "cost": int(props.get("cost", 5) or 5),
                        "flexibility": int(props.get("flexibility", 5) or 5),
                    },
                    "parts": parts,
                    "sources": [
                        s.get("id", "")
                        for s in item.get("source_items", [])
                        if s.get("id")
                    ],
                    "iconEmoji": item.get("emoji", "◇"),
                    "tags": item.get("tags", []),
                }
            )
        return {
            "schemaVersion": 1,
            "engine": "unity",
            "exportedBy": "ifmaker",
            "count": len(recipes),
            "recipes": recipes,
        }

    # ------------------------------------------------------------ Generic JSON

    def to_generic_json(self, items: List[Dict[str, Any]]) -> Dict[str, Any]:
        return {
            "schemaVersion": 1,
            "engine": "generic",
            "exportedBy": "ifmaker",
            "count": len(items),
            "items": [
                {
                    "id": it.get("id"),
                    "name": it.get("name") or it.get("concept_name"),
                    "category": it.get("category"),
                    "group": it.get("group"),
                    "summary": it.get("summary", ""),
                    "properties": it.get("properties")
                    or it.get("combined_properties")
                    or {},
                    "parts": self._extract_parts(it),
                    "sources": [
                        s.get("id")
                        for s in it.get("source_items", [])
                        if s.get("id")
                    ],
                    "tags": it.get("tags", []),
                    "diagram": it.get("diagram"),
                }
                for it in items
            ],
        }

    # ------------------------------------------------------------ CSV-like flat

    def to_flat_rows(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for it in items:
            props = it.get("properties") or it.get("combined_properties") or {}
            rows.append(
                {
                    "id": it.get("id"),
                    "name": it.get("name") or it.get("concept_name"),
                    "category": it.get("category"),
                    "group": it.get("group"),
                    "strength": props.get("strength"),
                    "flexibility": props.get("flexibility"),
                    "weight": props.get("weight"),
                    "heat_resistance": props.get("heat_resistance"),
                    "impact_absorption": props.get("impact_absorption"),
                    "cost": props.get("cost"),
                    "part_count": len(self._extract_parts(it)),
                    "tags": ";".join(it.get("tags", [])),
                }
            )
        return rows

    # ------------------------------------------------------------ Helpers

    @staticmethod
    def _extract_parts(item: Dict[str, Any]) -> List[Dict[str, Any]]:
        diag = item.get("diagram") or {}
        nodes = diag.get("nodes") or []
        if nodes:
            return [
                {
                    "id": n.get("id"),
                    "label": n.get("label"),
                    "source": n.get("source"),
                }
                for n in nodes
            ]
        struct = item.get("structure") or {}
        for key in ("parts", "layers"):
            arr = struct.get(key)
            if isinstance(arr, list) and arr:
                return [
                    {"id": f"{key[0]}{i+1}", "label": str(p)}
                    for i, p in enumerate(arr)
                ]
        return []

    @staticmethod
    def _infer_rarity(props: Dict[str, Any]) -> str:
        try:
            cost = float(props.get("cost", 5) or 5)
        except (TypeError, ValueError):
            cost = 5.0
        if cost >= 9:
            return "legendary"
        if cost >= 7:
            return "epic"
        if cost >= 5:
            return "rare"
        if cost >= 3:
            return "uncommon"
        return "common"

    @staticmethod
    def _stable_guid(source: str) -> str:
        """Unity uses 32-hex GUIDs. Derive a deterministic one from the id."""
        h = hashlib.md5((source or "untitled").encode("utf-8")).hexdigest()
        return h  # 32 hex chars

    @staticmethod
    def slugify(text: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
        return slug or "untitled"

from __future__ import annotations

from typing import Any, Dict, List, Optional

from services.data_loader import load_json


class AnalysisService:
    """
    IF Maker v0 single-item analysis engine.

    Responsibilities:
    1. Load materials / objects
    2. Return full item detail
    3. Build a normalized analysis payload
    4. Prepare simple structure-diagram data
    """

    def __init__(self) -> None:
        self.materials: List[Dict[str, Any]] = load_json("materials.json")
        self.objects: List[Dict[str, Any]] = load_json("objects.json")
        try:
            self.elements: List[Dict[str, Any]] = load_json("elements.json")
        except FileNotFoundError:
            self.elements = []
        self.items_by_id: Dict[str, Dict[str, Any]] = {}

        for item in self.materials + self.objects + self.elements:
            self.items_by_id[item["id"]] = item

    def analyze(self, item_id: str) -> Dict[str, Any]:
        item = self.items_by_id.get(item_id)
        if item is None:
            raise ValueError(f"Unknown item_id: {item_id}")

        return {
            "id": item["id"],
            "name": item["name"],
            "category": item["category"],
            "group": item.get("group"),
            "emoji": item.get("emoji"),
            "shape": item.get("shape"),
            "summary": item.get("summary", ""),
            "tags": item.get("tags", []),
            "properties": item.get("properties", {}),
            "structure": item.get("structure", {}),
            "diagram": item.get("diagram") or self._build_diagram(item),
            "uses": item.get("uses", []),
            "risks": item.get("risks", []),
            "related_suggestions": self._related_suggestions(item),
        }

    def _build_diagram(self, item: Dict[str, Any]) -> Dict[str, Any]:
        structure = item.get("structure", {})
        structure_type = structure.get("type", "unknown")

        builders = {
            "layered": self._build_layered_diagram,
            "surface_layer": self._build_surface_layer_diagram,
            "soft_body": self._build_soft_body_diagram,
            "solid": self._build_solid_diagram,
            "continuous": self._build_solid_diagram,
            "fibrous": self._build_solid_diagram,
            "part_based": self._build_part_based_diagram,
            "layered_shell": self._build_layered_shell_diagram,
            "layered_wearable": self._build_layered_wearable_diagram,
            "precision_tool": self._build_precision_tool_diagram,
        }

        builder = builders.get(structure_type, self._build_generic_diagram)
        return builder(item)

    def _build_layered_diagram(self, item: Dict[str, Any]) -> Dict[str, Any]:
        layers = item.get("structure", {}).get("layers", [])
        nodes = []
        edges = []

        prev_id: Optional[str] = None
        for idx, layer in enumerate(layers):
            node_id = f"layer_{idx+1}"
            nodes.append({"id": node_id, "label": layer})
            if prev_id:
                edges.append({"from": prev_id, "to": node_id, "type": "stacked_on"})
            prev_id = node_id

        return {"type": "layered", "nodes": nodes, "edges": edges}

    def _build_surface_layer_diagram(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "type": "surface_layer",
            "nodes": [
                {"id": "surface", "label": "Surface Coating"},
                {"id": "base", "label": "Underlying Base Material"},
            ],
            "edges": [{"from": "surface", "to": "base", "type": "covers"}],
        }

    def _build_soft_body_diagram(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "type": "soft_body",
            "nodes": [{"id": "core", "label": "Soft Core Body"}],
            "edges": [],
        }

    def _build_solid_diagram(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "type": "solid",
            "nodes": [{"id": "body", "label": f"{item.get('name','Solid')} Body"}],
            "edges": [],
        }

    def _build_part_based_diagram(self, item: Dict[str, Any]) -> Dict[str, Any]:
        parts = item.get("structure", {}).get("parts", [])
        relations = item.get("structure", {}).get("relations", [])

        nodes = [{"id": f"part_{i+1}", "label": part} for i, part in enumerate(parts)]

        edges = []
        for i in range(max(0, len(nodes) - 1)):
            edges.append(
                {
                    "from": nodes[i]["id"],
                    "to": nodes[i + 1]["id"],
                    "type": "connected",
                }
            )

        notes = [{"id": f"rel_{i+1}", "text": rel} for i, rel in enumerate(relations)]

        return {"type": "part_based", "nodes": nodes, "edges": edges, "notes": notes}

    def _build_layered_shell_diagram(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "type": "layered_shell",
            "nodes": [
                {"id": "outer", "label": "Outer Shell"},
                {"id": "mount", "label": "Mounting Points"},
                {"id": "inner", "label": "Internal Cavity"},
            ],
            "edges": [
                {"from": "outer", "to": "inner", "type": "encloses"},
                {"from": "mount", "to": "outer", "type": "attached_to"},
            ],
        }

    def _build_layered_wearable_diagram(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "type": "layered_wearable",
            "nodes": [
                {"id": "outer", "label": "Outer Protective Layer"},
                {"id": "inner", "label": "Inner Comfort Layer"},
                {"id": "palm", "label": "Palm Grip Zone"},
                {"id": "finger", "label": "Finger Zones"},
            ],
            "edges": [
                {"from": "outer", "to": "inner", "type": "covers"},
                {"from": "palm", "to": "inner", "type": "embedded_in"},
                {"from": "finger", "to": "inner", "type": "embedded_in"},
            ],
        }

    def _build_precision_tool_diagram(self, item: Dict[str, Any]) -> Dict[str, Any]:
        parts = item.get("structure", {}).get("parts", [])
        if len(parts) >= 4:
            return {
                "type": "precision_tool",
                "nodes": [{"id": f"p{i+1}", "label": p} for i, p in enumerate(parts)],
                "edges": [
                    {"from": f"p{i+1}", "to": f"p{i+2}", "type": "connected"}
                    for i in range(len(parts) - 1)
                ],
            }

        return {
            "type": "precision_tool",
            "nodes": [
                {"id": "tip", "label": "Tip"},
                {"id": "arms", "label": "Grip Arms"},
                {"id": "joint", "label": "Joint Mechanism"},
                {"id": "linkage", "label": "Control Linkage"},
            ],
            "edges": [
                {"from": "linkage", "to": "joint", "type": "drives"},
                {"from": "joint", "to": "arms", "type": "controls"},
                {"from": "arms", "to": "tip", "type": "positions"},
            ],
        }

    def _build_generic_diagram(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "type": "generic",
            "nodes": [{"id": "core", "label": item.get("name", "Core")}],
            "edges": [],
        }

    def _related_suggestions(self, item: Dict[str, Any]) -> List[Dict[str, str]]:
        current_tags = set(item.get("tags", []))
        current_id = item["id"]
        current_category = item["category"]

        suggestions: List[Dict[str, str]] = []

        for other in self.items_by_id.values():
            if other["id"] == current_id:
                continue
            if other["category"] != current_category:
                continue

            other_tags = set(other.get("tags", []))
            if current_tags.intersection(other_tags):
                suggestions.append(
                    {
                        "id": other["id"],
                        "name": other["name"],
                        "reason": "shared category and overlapping tags",
                    }
                )

        return suggestions[:5]

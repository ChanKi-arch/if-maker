from __future__ import annotations

from typing import Any, Dict, List, Optional
import hashlib
import re

GROUP_KEYWORDS = {
    "metal": [
        "metal", "iron", "steel", "aluminum", "copper", "gold", "silver",
        "platinum", "bronze", "brass", "tin", "zinc", "lead", "titanium",
        "nickel", "mercury", "cobalt", "tungsten", "chromium",
    ],
    "composite": [
        "composite", "carbon", "graphene", "fiberglass", "reinforced",
        "laminate", "plywood",
    ],
    "polymer": [
        "polymer", "plastic", "rubber", "latex", "silicone", "pvc",
        "polyethylene", "polycarbonate", "nylon", "acrylic", "resin",
    ],
    "ceramic": [
        "ceramic", "porcelain", "clay", "brick", "tile", "enamel",
        "alumina", "zirconia",
    ],
    "foam": ["foam", "sponge", "eva", "styrofoam"],
    "glass": ["glass", "crystal", "quartz", "diamond", "gem", "sapphire", "ruby"],
    "wood": ["wood", "oak", "pine", "maple", "birch", "cedar", "bamboo", "mahogany"],
    "fiber": [
        "fiber", "yarn", "cotton", "wool", "silk", "linen", "hemp",
        "kevlar", "aramid", "thread", "fabric",
    ],
}

FURNITURE = ["chair", "table", "sofa", "bed", "desk", "shelf", "stool", "bench"]
ROBOTICS = ["robot", "drone", "arm", "gripper", "servo", "actuator"]
WEARABLE = ["glove", "helmet", "jacket", "boot", "vest", "mask", "suit", "shoe"]
OPTICAL = ["lens", "mirror", "prism", "telescope", "microscope", "camera"]

GROUP_EMOJI = {
    "metal": "⬜",
    "composite": "🕸️",
    "polymer": "🔶",
    "ceramic": "🔲",
    "foam": "☁️",
    "glass": "🪟",
    "wood": "🪵",
    "fiber": "🧶",
    "furniture": "🪑",
    "robotics": "🤖",
    "wearable": "🧤",
    "optical": "🔍",
    "unknown": "◇",
}


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return slug or "custom_item"


def _hash_props(seed: str, group: str) -> Dict[str, int]:
    """
    Deterministic property generator driven by a hash of the name.
    Same input → same output (good for reproducibility in a demo).
    """
    h = hashlib.sha256(seed.encode("utf-8")).digest()
    # 6 bytes → 6 property axes (each 0..9)
    base = [(b % 10) + 1 for b in h[:6]]  # 1..10

    # Group-based biasing so "gold" (metal) leans metallic, etc.
    bias = {
        "metal":     (+1, -2,  0, +1, -1,  0),
        "composite": (+2, -1, -2,  0,  0, +1),
        "polymer":   (-3, +3, -1, -2, +3, -2),
        "ceramic":   (-1, -3, -1, +2, -2, +1),
        "foam":      (-4, +3, -4, -2, +3, -3),
        "glass":     ( 0, -4,  0, +1, -3, -1),
        "wood":      (-1,  0, -1, -2,  0, -2),
        "fiber":     (+1, +1, -2,  0, +1, +1),
    }.get(group, (0, 0, 0, 0, 0, 0))

    axes = [
        max(1, min(10, base[i] + bias[i])) for i in range(6)
    ]
    return {
        "strength": axes[0],
        "flexibility": axes[1],
        "weight": axes[2],
        "heat_resistance": axes[3],
        "impact_absorption": axes[4],
        "cost": axes[5],
    }


def _infer_group(name_lower: str) -> tuple[str, str]:
    """Returns (group, category)."""
    for g, keys in GROUP_KEYWORDS.items():
        for k in keys:
            if k in name_lower:
                return g, "material"

    for k in FURNITURE:
        if k in name_lower:
            return "furniture", "object"
    for k in ROBOTICS:
        if k in name_lower:
            return "robotics", "object"
    for k in WEARABLE:
        if k in name_lower:
            return "wearable", "object"
    for k in OPTICAL:
        if k in name_lower:
            return "optical", "object"

    return "unknown", "material"


class CreateService:
    """
    Generate a new material/object on demand.

    Uses LLM (via llm_service) when enabled, falls back to deterministic
    heuristics otherwise.
    """

    def __init__(self, llm_service: Any = None) -> None:
        self.llm_service = llm_service

    def create_item(
        self,
        name: str,
        hint: Optional[str] = None,
    ) -> Dict[str, Any]:
        name = (name or "").strip()
        if not name:
            raise ValueError("name is required")

        # Try LLM first if available; fall back to heuristic on any failure.
        if self.llm_service and self.llm_service.is_enabled():
            llm_item = self._llm_create(name, hint)
            if llm_item:
                return llm_item

        return self._heuristic_create(name, hint)

    def _heuristic_create(
        self,
        name: str,
        hint: Optional[str] = None,
    ) -> Dict[str, Any]:
        name_lower = _normalize(name + " " + (hint or ""))
        group, category = _infer_group(name_lower)

        props = _hash_props(name_lower, group)

        item_id = f"user_{_slugify(name)}"
        emoji = GROUP_EMOJI.get(group, "◇")

        summary = (
            f"User-generated {category} named {name.title()} "
            f"(inferred group: {group}). Properties are speculative."
        )
        if hint:
            summary += f" Hint: {hint}."

        tags = self._build_tags(group, name_lower)
        structure = self._build_structure(group)

        return {
            "id": item_id,
            "name": name.title(),
            "category": category,
            "group": group,
            "emoji": emoji,
            "summary": summary,
            "tags": tags,
            "properties": props,
            "structure": structure,
            "uses": self._build_uses(group),
            "risks": ["speculative properties", "unverified behavior"],
            "user_generated": True,
        }

    def _llm_create(
        self,
        name: str,
        hint: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Ask the LLM to generate a full material spec as JSON.
        Returns None on any failure so the caller can fall back.
        """
        try:
            prompt = (
                f"Generate a virtual-lab material spec for '{name}'"
                + (f" (hint: {hint})" if hint else "")
                + ".\n\n"
                f"Return ONE JSON object, no markdown fences, with keys:\n"
                f"  category   (either 'material' or 'object')\n"
                f"  group      (one of: metal, composite, polymer, ceramic, "
                f"foam, glass, wood, fiber, furniture, robotics, wearable, optical)\n"
                f"  emoji      (single emoji char that visually represents it)\n"
                f"  summary    (1-2 sentences, physically grounded)\n"
                f"  tags       (array of 3-5 short lowercase strings)\n"
                f"  properties (object with integer values 1-10 for: "
                f"strength, flexibility, weight, heat_resistance, "
                f"impact_absorption, cost)\n"
                f"  structure  (object: {{type, form, layers}})\n"
                f"  uses       (array of 2-3 short strings)\n"
                f"  risks      (array of 2-3 short strings)\n\n"
                f"Only valid JSON, nothing else."
            )

            client = self.llm_service._client  # type: ignore
            if client is None:
                return None

            response = client.chat.completions.create(
                model=self.llm_service.model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a materials-science assistant for a "
                            "virtual lab. Respond ONLY with a single valid "
                            "JSON object. No prose, no code fences."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.75,
                max_tokens=700,
            )
            content = response.choices[0].message.content or ""
            data = self.llm_service._parse_json_response(content)
            if not data:
                return None

            group = str(data.get("group", "unknown")).lower().strip()
            category = str(data.get("category", "material")).lower().strip()
            if category not in ("material", "object"):
                category = "material"

            props_raw = data.get("properties") or {}
            props: Dict[str, int] = {}
            for k, v in props_raw.items():
                try:
                    iv = int(round(float(v)))
                    props[k] = max(1, min(10, iv))
                except (TypeError, ValueError):
                    continue

            item_id = f"user_{_slugify(name)}"

            return {
                "id": item_id,
                "name": name.title(),
                "category": category,
                "group": group,
                "emoji": str(data.get("emoji") or GROUP_EMOJI.get(group, "◇")),
                "summary": str(data.get("summary") or f"AI-generated {name}."),
                "tags": [str(t) for t in (data.get("tags") or [])[:6]],
                "properties": props or _hash_props(_normalize(name), group),
                "structure": data.get("structure") or self._build_structure(group),
                "uses": [str(u) for u in (data.get("uses") or [])[:5]]
                or self._build_uses(group),
                "risks": [str(r) for r in (data.get("risks") or [])[:5]]
                or ["speculative properties"],
                "user_generated": True,
                "llm_generated": True,
            }
        except Exception:
            return None

    @staticmethod
    def _build_tags(group: str, name_lower: str) -> List[str]:
        tags = [group]
        # Pull a few keywords from the name
        for w in re.findall(r"[a-z]+", name_lower):
            if len(w) >= 4 and w not in tags:
                tags.append(w)
            if len(tags) >= 5:
                break
        return tags

    @staticmethod
    def _build_structure(group: str) -> Dict[str, Any]:
        if group in ("composite", "fiber"):
            return {
                "type": "layered",
                "form": "sheet",
                "layers": ["primary matrix", "reinforcement layer"],
            }
        if group in ("metal", "glass", "ceramic", "wood"):
            return {"type": "solid", "form": "bulk", "layers": [f"{group} bulk"]}
        if group in ("polymer", "foam"):
            return {"type": "soft_body", "form": "compliant", "layers": [f"{group} core"]}
        if group in ("furniture", "robotics", "wearable", "optical"):
            return {
                "type": "part_based",
                "parts": ["main body", "auxiliary parts"],
                "relations": ["main body supports auxiliary parts"],
            }
        return {"type": "solid", "form": "bulk", "layers": ["core"]}

    @staticmethod
    def _build_uses(group: str) -> List[str]:
        table = {
            "metal": ["frames", "fasteners", "tools"],
            "composite": ["panels", "shells", "high-performance parts"],
            "polymer": ["seals", "cushioning", "housings"],
            "ceramic": ["coatings", "insulators", "wear parts"],
            "foam": ["padding", "insulation", "packaging"],
            "glass": ["windows", "optics", "screens"],
            "wood": ["frames", "furniture", "handles"],
            "fiber": ["reinforcement", "textiles", "insulation"],
            "furniture": ["seating", "workspace", "living space"],
            "robotics": ["automation", "manipulation", "sensing"],
            "wearable": ["protection", "comfort", "daily use"],
            "optical": ["imaging", "focusing", "observation"],
        }
        return table.get(group, ["speculative applications"])

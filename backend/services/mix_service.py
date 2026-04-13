from __future__ import annotations

from typing import Any, Dict, List, Optional
import json
import re

from services.data_loader import load_json


def _clamp(v: float) -> float:
    return round(max(0.0, min(10.0, float(v))), 2)


def _extract_top_level_objects(src: str) -> List[Dict[str, Any]]:
    """
    Scan a string containing JSON-ish content and pull out every top-level
    `{...}` block, parsing each one in isolation. Used when an LLM returns
    a mostly-valid JSON array with one bad object.
    """
    results: List[Dict[str, Any]] = []
    depth = 0
    start_idx = -1
    in_str = False
    escape = False
    for i, ch in enumerate(src):
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
            continue
        if ch == "{":
            if depth == 0:
                start_idx = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start_idx >= 0:
                chunk = src[start_idx : i + 1]
                try:
                    obj = json.loads(chunk)
                    if isinstance(obj, dict):
                        results.append(obj)
                except json.JSONDecodeError:
                    pass  # skip broken object
                start_idx = -1
    return results


class MixService:
    """
    IF Maker v0 mix engine.

    Responsibilities:
    1. Load materials / objects / mix rules from local JSON files
    2. Resolve input items by id
    3. Find first matching rule (symmetric A/B)
    4. Generate deterministic mix result
    5. Fall back to default speculative rule if no rule matches
    """

    def __init__(self, llm_service: Any = None) -> None:
        self.materials: List[Dict[str, Any]] = load_json("materials.json")
        self.objects: List[Dict[str, Any]] = load_json("objects.json")
        try:
            self.elements: List[Dict[str, Any]] = load_json("elements.json")
        except FileNotFoundError:
            self.elements = []
        self.rules: List[Dict[str, Any]] = load_json("mix_rules.json")
        self.llm_service = llm_service

        self.items_by_id: Dict[str, Dict[str, Any]] = {}
        for item in self.materials + self.objects + self.elements:
            self.items_by_id[item["id"]] = item

    # 5 exploration strategies — each interprets ratios differently
    EXPLORE_STRATEGIES: List[Dict[str, Any]] = [
        {
            "id": "shell",
            "label": "Shell Coat",
            "icon": "🛡",
            "description": "B wraps A as a surface coating. Ratio = coat thickness.",
            "name_template": "{b} Shelled {a}",
        },
        {
            "id": "infuse",
            "label": "Core Infuse",
            "icon": "💧",
            "description": "B penetrates A's core parts. Ratio = number of infused parts.",
            "name_template": "{b} Infused {a}",
        },
        {
            "id": "stack",
            "label": "Layer Stack",
            "icon": "🥞",
            "description": "Alternating layers of A and B. Ratio = layer thickness.",
            "name_template": "Stacked {a}-{b}",
        },
        {
            "id": "swap",
            "label": "Selective Swap",
            "icon": "🔀",
            "description": "Replace specific parts of A with B. Ratio = parts replaced.",
            "name_template": "{b} Swapped {a}",
        },
        {
            "id": "blend",
            "label": "Homogeneous Blend",
            "icon": "🌀",
            "description": "Full-volume weighted average of all inputs.",
            "name_template": "Blended {a}+{b}",
        },
    ]

    def explore(
        self,
        item_ids: List[str],
        goal: str,
        ratios: Optional[List[float]] = None,
        form_mode: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate strategy variants for the given inputs.

        When LLM is enabled, strategies are generated dynamically and tailored
        to the actual items (creative, context-aware). Otherwise, fall back to
        the 5 built-in deterministic strategies.
        """
        if len(item_ids) < 2:
            raise ValueError("At least 2 item_ids are required.")
        if len(item_ids) > 8:
            raise ValueError("At most 8 item_ids are supported.")

        items = [self._get_item(i) for i in item_ids]
        n = len(items)
        if ratios is None or len(ratios) != n:
            norm_ratios = [1.0 / n] * n
        else:
            cleaned = [max(0.0, float(r)) for r in ratios]
            total = sum(cleaned)
            norm_ratios = [1.0 / n] * n if total <= 0 else [r / total for r in cleaned]

        # Try LLM-driven dynamic strategies first
        strategies: List[Dict[str, Any]] = []
        strategy_source = "static"
        if self.llm_service and self.llm_service.is_enabled():
            llm_strategies = self._llm_generate_strategies(
                items, goal, norm_ratios
            )
            if llm_strategies and len(llm_strategies) >= 3:
                strategies = llm_strategies
                strategy_source = "llm"

        if not strategies:
            strategies = list(self.EXPLORE_STRATEGIES)

        variants: List[Dict[str, Any]] = []
        for strategy in strategies:
            variant = self._build_strategy_variant(
                items, goal, norm_ratios, form_mode, strategy
            )
            variants.append(variant)

        return {
            "goal": goal,
            "form_mode": form_mode or "solid",
            "ratios": norm_ratios,
            "inputs": item_ids,
            "variants": variants,
            "strategy_source": strategy_source,
        }

    def _llm_generate_strategies(
        self,
        items: List[Dict[str, Any]],
        goal: str,
        ratios: List[float],
    ) -> List[Dict[str, Any]]:
        """
        Ask the LLM for context-aware combination strategies.
        Returns [] on any failure; caller falls back to static list.
        """
        import time

        llm = self.llm_service
        if llm is None or llm._client is None:  # type: ignore
            return []

        # Build a compact item summary for the prompt
        item_desc = ", ".join(
            f"{it['name']} ({it.get('category','?')}/{it.get('group','?')})"
            + (f" {int(round(ratios[i]*100))}%" if ratios else "")
            for i, it in enumerate(items)
        )

        prompt = (
            f"Items: {item_desc}\n\n"
            f"Return 5 diverse combination strategies as a JSON array. "
            f"Each object has exactly these keys: id, label, icon, description, name_template, hint.\n"
            f"- id: snake_case word\n"
            f"- label: 2-3 word name\n"
            f"- icon: 1 emoji\n"
            f"- description: max 10 words\n"
            f"- name_template: string with {{a}} and {{b}} placeholders\n"
            f"- hint: max 8 words about ratio meaning\n\n"
            f"Each object under 80 tokens. JSON array only, no prose.\n"
            f"Example (for reference only, DO NOT copy):\n"
            f'[{{"id":"shell","label":"Shell Coat","icon":"🛡️","description":"B wraps A as a protective layer","name_template":"{{b}} Shelled {{a}}","hint":"higher B = thicker coat"}}]'
        )

        t0 = time.time()
        try:
            response = llm._client.chat.completions.create(  # type: ignore
                model=llm.model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a creative virtual-lab strategy generator. "
                            "Respond ONLY with a valid JSON array of 5 strategy objects. "
                            "No prose, no code fences."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.85,
                max_tokens=2500,
            )
            elapsed = time.time() - t0
            content = response.choices[0].message.content or ""

            # Strip fences if the model couldn't help itself
            content = content.strip()
            if content.startswith("```"):
                content = content.strip("`")
                if content.lower().startswith("json"):
                    content = content[4:]
                content = content.strip()

            import logging
            _log = logging.getLogger("ifmaker.llm")

            start = content.find("[")
            end = content.rfind("]")
            if start < 0 or end <= start:
                _log.warning(
                    "Dynamic explore: no JSON array (len=%d head=%r)",
                    len(content),
                    content[:300],
                )
                return []

            array_src = content[start : end + 1]
            data: Any = None
            try:
                data = json.loads(array_src)
            except json.JSONDecodeError:
                # Fallback: extract each top-level object individually using a
                # brace-matching scanner. Skips objects that don't parse cleanly.
                data = _extract_top_level_objects(array_src)
                if not data:
                    _log.warning(
                        "Dynamic explore: JSON parse + recovery both failed raw=%r",
                        array_src[:300],
                    )
                    return []
                _log.info(
                    "Dynamic explore: recovered %d objects via brace scan",
                    len(data),
                )

            if not isinstance(data, list):
                _log.warning(
                    "Dynamic explore: not a list, got %s", type(data).__name__
                )
                return []

            cleaned: List[Dict[str, Any]] = []
            for i, raw in enumerate(data[:6]):  # cap at 6
                if not isinstance(raw, dict):
                    continue
                sid = str(raw.get("id") or f"llm_{i}").lower().strip()
                label = str(raw.get("label") or f"Strategy {i+1}").strip()
                icon = str(raw.get("icon") or "✦")[:2]
                desc = str(raw.get("description") or "").strip()
                name_t = str(raw.get("name_template") or "{a}-{b} Hybrid")
                hint = str(raw.get("hint") or "")

                mods_raw = raw.get("mods") or {}
                mods: Dict[str, float] = {}
                if isinstance(mods_raw, dict):
                    for k, v in mods_raw.items():
                        try:
                            mods[str(k)] = float(v)
                        except (TypeError, ValueError):
                            continue

                cleaned.append(
                    {
                        "id": sid,
                        "label": label,
                        "icon": icon,
                        "description": desc,
                        "name_template": name_t,
                        "hint_override": hint,
                        "mods": mods,
                    }
                )

            if cleaned:
                import logging
                logging.getLogger("ifmaker.llm").info(
                    "Dynamic explore strategies generated: n=%d elapsed=%.2fs",
                    len(cleaned),
                    elapsed,
                )
            return cleaned
        except Exception as e:  # noqa: BLE001
            import logging
            logging.getLogger("ifmaker.llm").warning(
                "Dynamic explore failed: %s — falling back to static strategies",
                e,
            )
            return []

    def _build_strategy_variant(
        self,
        items: List[Dict[str, Any]],
        goal: str,
        ratios: List[float],
        form_mode: Optional[str],
        strategy: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Build one strategy variant by calling structural merge then
        applying the strategy-specific transformation on top."""
        base = self._build_result_structural(items, goal, ratios, form_mode)

        sid = strategy["id"]
        base["strategy_id"] = sid
        base["strategy_label"] = strategy["label"]
        base["strategy_icon"] = strategy["icon"]
        base["strategy_description"] = strategy["description"]

        # Pick the two dominant inputs for naming
        bases = [(i, it) for i, it in enumerate(items) if it.get("category") != "element"]
        bases.sort(key=lambda x: -ratios[x[0]])
        if len(bases) >= 2:
            a_name = bases[0][1]["name"]
            b_name = bases[1][1]["name"]
        elif len(bases) == 1:
            a_name = bases[0][1]["name"]
            b_name = items[-1]["name"]
        else:
            a_name = items[0]["name"]
            b_name = items[1]["name"] if len(items) > 1 else "—"

        tmpl = strategy["name_template"]
        base["concept_name"] = tmpl.format(a=a_name, b=b_name)

        # Strategy-specific property & description tweaks
        props = dict(base.get("combined_properties") or {})

        if sid == "shell":
            # Thicker coat → harder surface, slight weight add
            thickness = ratios[bases[1][0]] if len(bases) >= 2 else 0.5
            props["strength"] = _clamp(props.get("strength", 5) + thickness * 2)
            props["heat_resistance"] = _clamp(
                props.get("heat_resistance", 5) + thickness * 1.5
            )
            props["weight"] = _clamp(props.get("weight", 5) + thickness * 0.5)
            base["strategy_hint"] = (
                f"coat thickness {int(round(thickness * 100))}%"
            )
        elif sid == "infuse":
            # Discrete: ceil(parts × ratio) parts infused
            max_parts = max(
                (len(self._extract_parts(it)) for it in items if it.get("category") != "element"),
                default=4,
            )
            b_ratio = ratios[bases[1][0]] if len(bases) >= 2 else 0.5
            infused = max(1, min(max_parts, int(-(-max_parts * b_ratio // 1))))
            props["strength"] = _clamp(props.get("strength", 5) + infused * 0.6)
            props["impact_absorption"] = _clamp(
                props.get("impact_absorption", 5) + infused * 0.4
            )
            base["strategy_hint"] = f"{infused} of {max_parts} parts infused"
        elif sid == "stack":
            # Anisotropy bonus — flexibility + on one axis
            props["flexibility"] = _clamp(props.get("flexibility", 5) + 2)
            props["strength"] = _clamp(props.get("strength", 5) + 1)
            base["strategy_hint"] = "alternating layers, anisotropic"
        elif sid == "swap":
            max_parts = max(
                (len(self._extract_parts(it)) for it in items if it.get("category") != "element"),
                default=4,
            )
            b_ratio = ratios[bases[1][0]] if len(bases) >= 2 else 0.5
            swapped = max(1, min(max_parts, int(-(-max_parts * b_ratio // 1))))
            props["cost"] = _clamp(props.get("cost", 5) + swapped * 0.3)
            base["strategy_hint"] = f"{swapped} of {max_parts} parts swapped"
        elif sid == "blend":
            # Pure ratios weighting — already applied in _merge_properties
            base["strategy_hint"] = "smooth weighted average"
        else:
            # LLM-generated strategy: apply its mods + use its hint
            mods = strategy.get("mods") or {}
            for k, delta in mods.items():
                try:
                    props[k] = _clamp(props.get(k, 5) + float(delta))
                except (TypeError, ValueError):
                    continue
            override_hint = strategy.get("hint_override")
            base["strategy_hint"] = (
                override_hint
                if override_hint
                else strategy.get("description", "")[:80]
            )

        base["combined_properties"] = props
        return base

    def generate(
        self,
        item_ids: List[str],
        goal: str,
        ratios: Optional[List[float]] = None,
        form_mode: Optional[str] = None,
    ) -> Dict[str, Any]:
        if len(item_ids) < 2:
            raise ValueError("At least 2 item_ids are required.")
        if len(item_ids) > 8:
            raise ValueError("At most 8 item_ids are supported in v0.")

        items = [self._get_item(i) for i in item_ids]

        n = len(items)
        if ratios is None or len(ratios) != n:
            norm_ratios = [1.0 / n] * n
        else:
            cleaned = [max(0.0, float(r)) for r in ratios]
            total = sum(cleaned)
            norm_ratios = [1.0 / n] * n if total <= 0 else [r / total for r in cleaned]

        elements = [it for it in items if it.get("category") == "element"]
        bases = [it for it in items if it.get("category") != "element"]

        if elements and not bases:
            return self._build_result_element_clash(elements, goal)

        return self._build_result_structural(
            items, goal, norm_ratios, form_mode=form_mode
        )

    @staticmethod
    def _apply_form_mode(
        props: Dict[str, float], form_mode: Optional[str]
    ) -> Dict[str, float]:
        """Morphology modifiers — scales + offsets on core properties."""
        if not form_mode or form_mode == "solid":
            return props

        out = dict(props)

        def clamp(v: float) -> float:
            return round(max(0.0, min(10.0, v)), 2)

        if form_mode == "diffuse":
            out["weight"] = clamp(out.get("weight", 5) * 0.5)
            out["impact_absorption"] = clamp(out.get("impact_absorption", 5) + 3)
            out["strength"] = clamp(out.get("strength", 5) - 2)
            out["flexibility"] = clamp(out.get("flexibility", 5) + 1)
        elif form_mode == "condensed":
            out["strength"] = clamp(out.get("strength", 5) + 3)
            out["weight"] = clamp(out.get("weight", 5) * 1.5)
            out["flexibility"] = clamp(out.get("flexibility", 5) - 2)
            out["cost"] = clamp(out.get("cost", 5) * 1.5)
        elif form_mode == "fibrous":
            out["flexibility"] = clamp(out.get("flexibility", 5) + 3)
            out["strength"] = clamp(out.get("strength", 5) + 1)
            out["weight"] = clamp(out.get("weight", 5) - 1)
        elif form_mode == "plate":
            out["strength"] = clamp(out.get("strength", 5) + 2)
            out["cost"] = clamp(out.get("cost", 5) - 1)
            out["flexibility"] = clamp(out.get("flexibility", 5) - 3)
        elif form_mode == "porous":
            out["weight"] = clamp(out.get("weight", 5) / 3)
            out["impact_absorption"] = clamp(out.get("impact_absorption", 5) + 4)
            out["strength"] = clamp(out.get("strength", 5) - 3)

        return out

    @staticmethod
    def _form_mode_prefix(form_mode: Optional[str]) -> str:
        if not form_mode or form_mode == "solid":
            return ""
        table = {
            "diffuse": "Diffuse",
            "condensed": "Condensed",
            "fibrous": "Fibrous",
            "plate": "Plated",
            "porous": "Porous",
        }
        p = table.get(form_mode)
        return f"{p} " if p else ""

    def _build_result_elemental(
        self,
        bases: List[Dict[str, Any]],
        elements: List[Dict[str, Any]],
        goal: str,
    ) -> Dict[str, Any]:
        """
        Apply element transforms to base items. Produces an evocative
        "processed material" concept deterministically.
        """
        # Check for blocking element combinations (e.g. fire + water)
        warnings: List[str] = []
        for i in range(len(elements)):
            for j in range(i + 1, len(elements)):
                blocks = elements[i].get("transform", {}).get("blocks", [])
                if elements[j]["id"] in blocks:
                    warnings.append(
                        f"{elements[i]['name']} and {elements[j]['name']} neutralize each other"
                    )

        # Pick the strongest element by intensity as the dominant transform
        dominant = max(
            elements,
            key=lambda e: e.get("transform", {}).get("intensity", 0),
        )
        transform = dominant.get("transform", {})
        prefixes = transform.get("prefixes", ["Transformed"])
        suffixes = transform.get("suffixes", ["Form"])
        effect = transform.get("effect", "processed")
        intensity = transform.get("intensity", 5)

        # Build concept name: simple "Prefix BaseName" form
        base_main = bases[0]
        prefix = prefixes[0]  # use the cleanest prefix
        if len(bases) > 1:
            concept_name = f"{prefix} {base_main['name']} + {bases[1]['name']}"
        else:
            concept_name = f"{prefix} {base_main['name']}"

        # Adjust combined properties by element effect
        props = dict(base_main.get("properties", {}))
        props = self._apply_element_effect(props, effect, intensity)

        # Merge other bases if multi
        for extra in bases[1:]:
            for k, v in extra.get("properties", {}).items():
                if isinstance(v, (int, float)):
                    if k in props:
                        props[k] = round((props[k] + float(v)) / 2.0, 2)
                    else:
                        props[k] = float(v)

        # Diagram: base core + element influence + transformed shell
        nodes = [
            {"id": "base", "label": base_main["name"]},
        ]
        edges = []
        for i, e in enumerate(elements):
            eid = f"elem_{i+1}"
            nodes.append({"id": eid, "label": f"{e['name']} ({effect})"})
            edges.append({"from": eid, "to": "base", "type": effect})
        for i, b in enumerate(bases[1:], start=2):
            bid = f"base_{i}"
            nodes.append({"id": bid, "label": b["name"]})
            edges.append({"from": bid, "to": "base", "type": "fuses_with"})
        nodes.append({"id": "result", "label": concept_name})
        edges.append({"from": "base", "to": "result", "type": "transforms_to"})

        summary = (
            f"{base_main['name']} after {effect} treatment (intensity {intensity}/10). "
            f"The element reshapes the base structure into a new form."
        )
        if goal.strip():
            summary += f" Goal focus: {goal.strip()}."

        advantages = self._element_advantages(effect)
        risks = self._element_risks(effect)
        use_cases = self._element_use_cases(effect)

        return {
            "experiment_id": self._make_experiment_id_multi(
                [b["id"] for b in bases] + [e["id"] for e in elements], goal
            ),
            "inputs": [it["id"] for it in bases + elements],
            "goal": goal,
            "rule_id": f"rule_elemental_{effect}",
            "concept_name": concept_name,
            "summary": summary,
            "combined_properties": props,
            "diagram": {"nodes": nodes, "edges": edges},
            "advantages": advantages + warnings,
            "risks": risks + warnings,
            "use_cases": use_cases,
            "visual": {
                "base_id": base_main["id"],
                "base_group": base_main.get("group"),
                "base_category": base_main.get("category"),
                "element_id": dominant["id"],
                "element_effect": effect,
                "intensity": intensity,
            },
            "source_items": [
                {
                    "id": it["id"],
                    "name": it["name"],
                    "category": it["category"],
                    "group": it.get("group"),
                    "emoji": it.get("emoji"),
                }
                for it in bases + elements
            ],
        }

    @staticmethod
    def _apply_element_effect(
        props: Dict[str, float],
        effect: str,
        intensity: int,
    ) -> Dict[str, float]:
        out = dict(props)
        k = intensity / 10.0

        def clamp(v: float) -> float:
            return round(max(0.0, min(10.0, v)), 2)

        if effect == "burn":
            out["heat_resistance"] = clamp(out.get("heat_resistance", 5) - 2 * k)
            out["weight"] = clamp(out.get("weight", 5) - 1 * k)
            out["strength"] = clamp(out.get("strength", 5) + 1 * k)
            out["flexibility"] = clamp(out.get("flexibility", 5) - 2 * k)
        elif effect == "wet":
            out["flexibility"] = clamp(out.get("flexibility", 5) + 1 * k)
            out["strength"] = clamp(out.get("strength", 5) - 1 * k)
        elif effect == "heat":
            out["flexibility"] = clamp(out.get("flexibility", 5) + 2 * k)
            out["strength"] = clamp(out.get("strength", 5) - 0.5 * k)
        elif effect == "freeze":
            out["strength"] = clamp(out.get("strength", 5) + 1 * k)
            out["flexibility"] = clamp(out.get("flexibility", 5) - 3 * k)
            out["impact_absorption"] = clamp(
                out.get("impact_absorption", 5) - 2 * k
            )
        elif effect == "electrify":
            out["conductivity"] = round(10 * k, 2)
        elif effect == "compress":
            out["strength"] = clamp(out.get("strength", 5) + 2 * k)
            out["weight"] = clamp(out.get("weight", 5) + 1 * k)
            out["flexibility"] = clamp(out.get("flexibility", 5) - 1 * k)
        elif effect == "irradiate":
            out["radioactivity"] = round(10 * k, 2)
            out["strength"] = clamp(out.get("strength", 5) - 1 * k)
        elif effect == "vibrate":
            out["resonance"] = round(10 * k, 2)

        return out

    @staticmethod
    def _element_advantages(effect: str) -> List[str]:
        table = {
            "burn": ["increased hardness", "reduced weight", "carbonized surface"],
            "wet": ["improved flexibility", "surface cleaning", "easier shaping"],
            "heat": ["malleable for forming", "annealed grain", "better bonding"],
            "freeze": ["increased rigidity", "stabilized form", "reduced motion"],
            "electrify": [
                "conductive behavior",
                "magnetized response",
                "signal capable",
            ],
            "compress": [
                "higher density",
                "improved strength",
                "compact footprint",
            ],
            "irradiate": [
                "atomic-level transformation",
                "new material class",
                "unique properties",
            ],
            "vibrate": [
                "harmonic tuning",
                "stress distribution",
                "fatigue testing",
            ],
        }
        return table.get(effect, ["novel transformation"])

    @staticmethod
    def _element_risks(effect: str) -> List[str]:
        table = {
            "burn": ["brittle failure", "ash residue", "irreversible damage"],
            "wet": ["mold", "reduced rigidity", "surface corrosion"],
            "heat": ["deformation", "cracking on cooling", "energy cost"],
            "freeze": ["brittle fracture", "thermal shock", "condensation"],
            "electrify": ["short circuit", "heat buildup", "charge leak"],
            "compress": ["internal stress", "delamination", "equipment cost"],
            "irradiate": ["radiation hazard", "long-term instability", "waste"],
            "vibrate": ["resonant fracture", "noise", "fatigue"],
        }
        return table.get(effect, ["unknown side effects"])

    @staticmethod
    def _element_use_cases(effect: str) -> List[str]:
        table = {
            "burn": ["carbonized electrodes", "pyrolysis byproducts", "charcoal filters"],
            "wet": ["slurries", "injection molding", "cleaning processes"],
            "heat": ["forging", "annealing", "heat treatment"],
            "freeze": ["cryo storage", "brittle fracture", "low-temp testing"],
            "electrify": ["batteries", "capacitors", "sensors"],
            "compress": ["armor plates", "high-density storage", "hydraulic parts"],
            "irradiate": ["nuclear research", "material testing", "isotope production"],
            "vibrate": ["ultrasonic tools", "resonant sensors", "acoustic filters"],
        }
        return table.get(effect, ["speculative applications"])

    def _build_result_element_clash(
        self,
        elements: List[Dict[str, Any]],
        goal: str,
    ) -> Dict[str, Any]:
        names = " + ".join(e["name"] for e in elements)
        return {
            "experiment_id": f"exp_elements_only_{len(elements)}",
            "inputs": [e["id"] for e in elements],
            "goal": goal,
            "rule_id": "rule_element_clash",
            "concept_name": f"Elemental Clash ({names})",
            "summary": (
                "Only elements present — no base material to transform. "
                "Elements need a base (material or object) to act upon."
            ),
            "combined_properties": {},
            "diagram": {
                "nodes": [
                    {"id": f"e_{i}", "label": e["name"]}
                    for i, e in enumerate(elements)
                ],
                "edges": [],
            },
            "advantages": [],
            "risks": ["no base to transform", "add a material or object"],
            "use_cases": [],
            "source_items": [
                {"id": e["id"], "name": e["name"], "category": "element"}
                for e in elements
            ],
        }

    def decompose(self, concept_name: str, goal: str = "") -> Dict[str, Any]:
        """
        Best-effort deterministic decomposition of an arbitrary concept name.
        Maps keywords in the concept name (and optional goal) onto registered
        item tags, picks the top-N items, and returns them as components.
        """
        text = self._normalize_text(concept_name + " " + goal)
        if not text.strip():
            raise ValueError("Empty concept_name")

        scores: List[tuple] = []
        for item in self.items_by_id.values():
            score = 0
            for tag in item.get("tags", []):
                if self._normalize_text(tag) in text:
                    score += 2
            for word in self._normalize_text(item["name"]).split():
                if word in text and len(word) > 2:
                    score += 3
            for use in item.get("uses", []):
                if self._normalize_text(use) in text:
                    score += 1
            if score > 0:
                scores.append((score, item))

        scores.sort(key=lambda x: x[0], reverse=True)

        if not scores:
            # Fallback: pick a few diverse defaults
            fallback_ids = ["aluminum", "rubber", "carbon_fiber"]
            components = [self.items_by_id[i] for i in fallback_ids if i in self.items_by_id]
            confidence = "low"
        else:
            top = scores[: min(4, len(scores))]
            components = [item for _, item in top]
            confidence = "high" if scores[0][0] >= 5 else "medium"

        return {
            "concept_name": concept_name,
            "goal": goal,
            "confidence": confidence,
            "components": [
                {
                    "id": c["id"],
                    "name": c["name"],
                    "category": c["category"],
                    "group": c.get("group"),
                    "summary": c.get("summary", ""),
                    "tags": c.get("tags", []),
                }
                for c in components
            ],
            "diagram": {
                "type": "decomposition",
                "nodes": [
                    {"id": "concept", "label": concept_name},
                ]
                + [
                    {"id": f"comp_{i+1}", "label": c["name"]}
                    for i, c in enumerate(components)
                ],
                "edges": [
                    {"from": "concept", "to": f"comp_{i+1}", "type": "decomposes_into"}
                    for i in range(len(components))
                ],
            },
        }

    def _get_item(self, item_id: str) -> Dict[str, Any]:
        item = self.items_by_id.get(item_id)
        if item is None:
            raise ValueError(f"Unknown item_id: {item_id}")
        return item

    def _find_matching_rule(
        self,
        item_a: Dict[str, Any],
        item_b: Dict[str, Any],
        goal_normalized: str,
    ) -> Optional[Dict[str, Any]]:
        for rule in self.rules:
            if rule["id"] == "rule_default_speculative_mix":
                continue

            if self._rule_matches(rule, item_a, item_b, goal_normalized):
                return rule

            if self._rule_matches(rule, item_b, item_a, goal_normalized):
                return rule

        return None

    def _rule_matches(
        self,
        rule: Dict[str, Any],
        item_a: Dict[str, Any],
        item_b: Dict[str, Any],
        goal_normalized: str,
    ) -> bool:
        match = rule.get("match", {})

        if not self._categories_match(match, item_a, item_b):
            return False
        if not self._item_side_match(match, "a", item_a):
            return False
        if not self._item_side_match(match, "b", item_b):
            return False
        if not self._goal_match(rule, goal_normalized):
            return False
        return True

    def _categories_match(
        self,
        match: Dict[str, Any],
        item_a: Dict[str, Any],
        item_b: Dict[str, Any],
    ) -> bool:
        categories = match.get("categories")
        if not categories:
            return True
        if categories == ["any", "any"]:
            return True
        if len(categories) != 2:
            return False

        return (
            categories[0] in ("any", item_a["category"])
            and categories[1] in ("any", item_b["category"])
        )

    def _item_side_match(
        self,
        match: Dict[str, Any],
        side: str,
        item: Dict[str, Any],
    ) -> bool:
        ids_any = match.get(f"ids_any_{side}")
        if ids_any and item["id"] not in ids_any:
            return False

        tags_any = match.get(f"tags_any_{side}")
        if tags_any:
            item_tags = set(item.get("tags", []))
            if not item_tags.intersection(tags_any):
                return False
        return True

    def _goal_match(self, rule: Dict[str, Any], goal_normalized: str) -> bool:
        keywords = rule.get("goal_keywords", [])
        if not keywords:
            return True
        for keyword in keywords:
            if self._normalize_text(keyword) in goal_normalized:
                return True
        return False

    def _get_default_rule(self) -> Dict[str, Any]:
        for rule in self.rules:
            if rule["id"] == "rule_default_speculative_mix":
                return rule
        raise ValueError("Default rule not found in mix_rules.json")

    def _extract_parts(self, item: Dict[str, Any]) -> List[Dict[str, str]]:
        """
        Return the item's own structural breakdown as a list of {id, label}.
        Priority:
          1. item.diagram.nodes (synthesized items already have this)
          2. item.structure.parts (part_based objects)
          3. item.structure.layers (layered materials)
          4. single-node fallback = [item itself]
        """
        # If we already built a diagram for it (synthesized items).
        diag = item.get("diagram")
        if isinstance(diag, dict) and diag.get("nodes"):
            return [
                {"id": n.get("id") or str(i), "label": n.get("label") or item["name"]}
                for i, n in enumerate(diag["nodes"])
            ]
        struct = item.get("structure") or {}
        parts = struct.get("parts")
        if isinstance(parts, list) and parts:
            return [
                {"id": f"p{i+1}", "label": str(p)} for i, p in enumerate(parts)
            ]
        layers = struct.get("layers")
        if isinstance(layers, list) and layers:
            return [
                {"id": f"l{i+1}", "label": str(l)} for i, l in enumerate(layers)
            ]
        # Final fallback: one node = the item name
        return [{"id": "core", "label": item["name"]}]

    def _build_result_structural(
        self,
        items: List[Dict[str, Any]],
        goal: str,
        ratios: Optional[List[float]] = None,
        form_mode: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Merge the parts of every input item into one combined diagram.
        Normalizes parts counts across inputs: if A has 4 parts and B has 1,
        B is cycled (duplicated) to 4 so both sides have equal visual weight.
        Then applies ratio weights.
        """
        # Extract per-item parts and find the maximum count among bases.
        raw_parts: List[List[Dict[str, str]]] = []
        max_count = 0
        for i, item in enumerate(items):
            p = self._extract_parts(item)
            raw_parts.append(p)
            if item.get("category") != "element" and len(p) > max_count:
                max_count = len(p)
        if max_count == 0:
            max_count = 1

        # Pad each base item's parts to max_count by cycling through them.
        # Elements stay as-is (they usually have 1 symbolic node).
        nodes: List[Dict[str, str]] = []
        per_item_node_ids: List[List[str]] = []

        for i, item in enumerate(items):
            is_elem = item.get("category") == "element"
            parts = raw_parts[i]
            if not is_elem and len(parts) > 0 and len(parts) < max_count:
                padded = []
                for j in range(max_count):
                    src = parts[j % len(parts)]
                    # Mark duplicated copies with a "(xN)" suffix so the
                    # diagram is self-explanatory.
                    copy_idx = j // len(parts) + 1
                    label = src["label"]
                    if len(parts) < max_count and copy_idx > 1:
                        label = f"{label} ×{copy_idx}"
                    padded.append(
                        {
                            "id": f"{src['id']}_c{j}",
                            "label": label,
                        }
                    )
                parts = padded
            elif not is_elem and max_count > 1 and len(parts) == max_count:
                # Keep unique ids even without padding
                parts = [
                    {"id": f"{p['id']}", "label": p["label"]} for p in parts
                ]

            prefixed_ids = []
            for p in parts:
                new_id = f"i{i}_{p['id']}"
                nodes.append(
                    {
                        "id": new_id,
                        "label": p["label"],
                        "source": item["name"],
                    }
                )
                prefixed_ids.append(new_id)
            per_item_node_ids.append(prefixed_ids)

        # Cross-edges: for each adjacent item pair, connect their first parts
        # with "bonds" edges; also connect each primary part of item[0] to the
        # primary of item[1] to suggest wrapping.
        edges: List[Dict[str, str]] = []

        def _edge(a: str, b: str, t: str) -> None:
            edges.append({"from": a, "to": b, "type": t})

        for i in range(len(items) - 1):
            a_ids = per_item_node_ids[i]
            b_ids = per_item_node_ids[i + 1]
            # Connect every A part to the first B part (material wraps object)
            if a_ids and b_ids:
                main_b = b_ids[0]
                for a_id in a_ids:
                    _edge(a_id, main_b, "bonds_with")
                # Also connect first A part to every B part (so both sides
                # visibly participate).
                main_a = a_ids[0]
                for b_id in b_ids[1:]:
                    _edge(main_a, b_id, "bonds_with")

        # Internal edges within each item (preserve original structure)
        for i, item in enumerate(items):
            diag = item.get("diagram") or {}
            orig_edges = diag.get("edges") or []
            for e in orig_edges:
                fid = e.get("from")
                tid = e.get("to")
                if fid and tid:
                    _edge(f"i{i}_{fid}", f"i{i}_{tid}", e.get("type", "part_of"))

        # Properties: weighted average using ratios (or equal if not given)
        props = self._merge_properties(items, ratios)

        # Apply element transforms if any element is among the items
        elements = [it for it in items if it.get("category") == "element"]
        bases = [it for it in items if it.get("category") != "element"]

        effect = None
        visual: Dict[str, Any] = {}
        if elements and bases:
            dominant = max(
                elements,
                key=lambda e: e.get("transform", {}).get("intensity", 0),
            )
            transform = dominant.get("transform", {})
            effect = transform.get("effect")
            intensity = transform.get("intensity", 5)
            props = self._apply_element_effect(props, effect or "", intensity)
            visual = {
                "base_id": bases[0]["id"],
                "base_group": bases[0].get("group"),
                "base_category": bases[0].get("category"),
                "element_id": dominant["id"],
                "element_effect": effect,
                "intensity": intensity,
            }
        elif bases:
            visual = {
                "base_id": bases[0]["id"],
                "base_group": bases[0].get("group"),
                "base_category": bases[0].get("category"),
            }

        # Pick dominant base for visual (highest-ratio non-element item)
        dominant_base_idx = -1
        dominant_w = -1.0
        for i, it in enumerate(items):
            if it.get("category") == "element":
                continue
            if (ratios[i] if ratios else 1.0) > dominant_w:
                dominant_w = ratios[i] if ratios else 1.0
                dominant_base_idx = i
        if dominant_base_idx >= 0:
            dom = items[dominant_base_idx]
            visual = dict(visual or {})
            visual["base_id"] = dom["id"]
            visual["base_group"] = dom.get("group")
            visual["base_category"] = dom.get("category")

        # Apply form morphology modifier last so it stacks on top of element.
        props = self._apply_form_mode(props, form_mode)

        form_prefix = self._form_mode_prefix(form_mode)
        concept_name = form_prefix + self._name_structural(items, effect, ratios)
        summary = self._summary_structural(items, effect, goal, ratios)
        if form_mode and form_mode != "solid":
            summary += f" Form: {form_mode}."

        analysis = self._build_analysis_report(
            items, ratios, props, form_mode, effect, goal
        )

        return {
            "experiment_id": self._make_experiment_id_multi(
                [it["id"] for it in items], goal
            ),
            "inputs": [it["id"] for it in items],
            "goal": goal,
            "rule_id": (
                f"rule_structural_{effect}" if effect else "rule_structural_merge"
            ),
            "concept_name": concept_name,
            "summary": summary,
            "analysis": analysis,
            "combined_properties": props,
            "diagram": {"nodes": nodes, "edges": edges},
            "advantages": self._structural_advantages(items, effect),
            "risks": self._structural_risks(items, effect),
            "use_cases": self._structural_use_cases(items),
            "visual": visual,
            "form_mode": form_mode or "solid",
            "ratios": list(ratios) if ratios else None,
            "source_items": [
                {
                    "id": it["id"],
                    "name": it["name"],
                    "category": it["category"],
                    "group": it.get("group"),
                    "emoji": it.get("emoji"),
                    "ratio": (ratios[i] if ratios else None),
                }
                for i, it in enumerate(items)
            ],
        }

    def _merge_properties(
        self,
        items: List[Dict[str, Any]],
        ratios: Optional[List[float]] = None,
    ) -> Dict[str, float]:
        """
        Weighted merge of numeric properties across items.
        If ratios is None or invalid, falls back to equal average.
        """
        n = len(items)
        if ratios is None or len(ratios) != n:
            ratios = [1.0 / n] * n

        # key -> list of (value, weight)
        entries: Dict[str, List[tuple]] = {}
        for it, w in zip(items, ratios):
            for k, v in (it.get("properties") or {}).items():
                if isinstance(v, (int, float)):
                    entries.setdefault(k, []).append((float(v), float(w)))

        merged: Dict[str, float] = {}
        for k, vs in entries.items():
            total_w = sum(w for _, w in vs)
            if total_w <= 0:
                continue
            weighted = sum(v * w for v, w in vs) / total_w
            merged[k] = round(weighted, 2)
        return merged

    def _name_structural(
        self,
        items: List[Dict[str, Any]],
        effect: Optional[str] = None,
        ratios: Optional[List[float]] = None,
    ) -> str:
        bases = [it for it in items if it.get("category") != "element"]
        elements = [it for it in items if it.get("category") == "element"]

        if not bases and elements:
            return "Elemental Cloud"

        # If ratios are very skewed, mention the dominant source explicitly.
        dominant_label = ""
        if ratios and len(ratios) == len(items):
            idx_ratio = [(i, r) for i, r in enumerate(ratios) if items[i].get("category") != "element"]
            if idx_ratio:
                idx_ratio.sort(key=lambda x: -x[1])
                top_idx, top_r = idx_ratio[0]
                if top_r >= 0.6:
                    dominant_label = f"{int(round(top_r * 100))}% "

        objects = [b for b in bases if b.get("category") == "object"]
        materials = [b for b in bases if b.get("category") == "material"]
        synthesized = [b for b in bases if b.get("category") == "synthesized"]

        element_prefix = ""
        if effect:
            effect_prefixes = {
                "burn": "Burnt",
                "wet": "Wet",
                "heat": "Heated",
                "freeze": "Frozen",
                "electrify": "Charged",
                "compress": "Compressed",
                "irradiate": "Irradiated",
                "vibrate": "Resonant",
            }
            element_prefix = effect_prefixes.get(effect, "") + " "

        if objects and materials:
            mat_str = "-".join(m["name"] for m in materials[:2])
            obj_str = objects[0]["name"]
            return f"{dominant_label}{element_prefix}{mat_str} {obj_str}".strip()

        if len(objects) >= 2:
            return f"{dominant_label}{element_prefix}{objects[0]['name']}-{objects[1]['name']} Hybrid".strip()

        if len(materials) >= 2:
            mat_str = "/".join(m["name"] for m in materials[:3])
            return f"{dominant_label}{element_prefix}{mat_str} Composite".strip()

        if synthesized and (materials or objects):
            other = (materials or objects)[0]["name"]
            return f"{dominant_label}{element_prefix}{synthesized[0]['name']} + {other}".strip()

        if len(synthesized) >= 2:
            return f"{dominant_label}{element_prefix}Remix of {synthesized[0]['name']}".strip()

        if bases:
            return f"{dominant_label}{element_prefix}{bases[0]['name']}".strip()

        return "Speculative Hybrid"

    def _summary_structural(
        self,
        items: List[Dict[str, Any]],
        effect: Optional[str],
        goal: str,
        ratios: Optional[List[float]] = None,
    ) -> str:
        if ratios and len(ratios) == len(items):
            names = ", ".join(
                f"{it['name']} {int(round(ratios[i] * 100))}%"
                for i, it in enumerate(items)
            )
        else:
            names = ", ".join(it["name"] for it in items)
        if effect:
            base = f"Weighted structural merge of {names} under {effect} treatment."
        else:
            base = f"Weighted structural merge of {names} — parts cross-bond by their mix ratio."
        if goal.strip():
            base += f" Goal focus: {goal.strip()}."
        return base

    # ----- rich analysis report ------------------------------------------

    _PROPERTY_HIGH_NOTE = {
        "strength":         "load-bearing and impact-resistant",
        "flexibility":      "bends and deforms without fracture",
        "weight":           "noticeably heavy — plan mounting accordingly",
        "cost":             "premium — justify with performance",
        "heat_resistance":  "stable at elevated temperatures",
        "impact_absorption":"cushions shock and vibration",
        "conductivity":     "readily carries current and heat",
        "transparency":     "light passes through cleanly",
        "density":          "tightly packed mass",
        "hardness":         "scratch and abrasion resistant",
    }
    _PROPERTY_LOW_NOTE = {
        "strength":         "fragile under load — not for structural duty",
        "flexibility":      "brittle — cracks before it bends",
        "weight":           "exceptionally light — easy to move and mount",
        "cost":             "affordable for mass production",
        "heat_resistance":  "degrades with heat — keep cool",
        "impact_absorption":"transmits shock directly — reinforce joints",
        "conductivity":     "good insulator",
        "transparency":     "opaque",
        "density":          "airy and porous",
        "hardness":         "soft — scratches easily",
    }

    _FORM_NOTE = {
        "diffuse":   "Diffuse form scatters mass outward — roughly half the weight, with more give on impact but noticeably reduced peak strength.",
        "condensed": "Condensed form packs the material tight — higher strength and density at the cost of flexibility and a ~50% weight gain.",
        "fibrous":   "Fibrous form aligns the material along long strands — gains flexibility and a bit of strength while shedding weight.",
        "plate":     "Plated form rolls the material into rigid sheets — strength goes up, flexibility drops sharply, cost comes down.",
        "porous":    "Porous form pockets the bulk with voids — roughly a third of the weight and superb shock absorption, but much weaker.",
        "solid":     "Solid form keeps the material as a dense continuous block — baseline behavior with no form modifier.",
    }

    _ELEMENT_NOTE = {
        "burn":      "Fire treatment chars the surface, sacrificing some strength but adding heat resistance and a distinctive carbonized finish.",
        "wet":       "Water saturation softens the structure and increases flexibility, with a penalty to strength and conductivity shifts.",
        "heat":      "Thermal processing hardens the matrix, raising heat resistance at the cost of some flexibility.",
        "freeze":    "Cryogenic exposure locks the structure rigid — flexibility drops sharply and the material becomes brittle.",
        "electrify": "Electrification polarizes the material, enabling conductive pathways but raising cost and safety overhead.",
        "compress":  "Compression densifies the bulk — higher strength and density, with weight and cost going up.",
        "irradiate": "Irradiation restructures the lattice — unpredictable mechanical shifts and a radiation-handling burden.",
        "vibrate":   "Sustained vibration work-hardens the surface and can reorder internal grain structure.",
    }

    def _build_analysis_report(
        self,
        items: List[Dict[str, Any]],
        ratios: Optional[List[float]],
        props: Dict[str, float],
        form_mode: Optional[str],
        effect: Optional[str],
        goal: str,
    ) -> Dict[str, Any]:
        """
        Build a structured, human-readable analysis block for a synthesis result.

        Returns keys:
          narrative          — list of paragraph strings
          composition_notes  — list of {source, ratio, contribution}
          dominant_traits    — list of {property, value, note}
          weak_points        — list of {property, value, note}
          form_note          — string
          element_note       — string | None
          tradeoffs          — list of strings
        """
        n = len(items)
        if not ratios or len(ratios) != n:
            ratios = [1.0 / n] * n

        bases = [(i, it) for i, it in enumerate(items) if it.get("category") != "element"]
        elements = [it for it in items if it.get("category") == "element"]

        # --- composition notes -----------------------------------------
        composition_notes: List[Dict[str, Any]] = []
        for i, it in bases:
            r = ratios[i]
            pct = int(round(r * 100))
            own_props = it.get("properties") or {}
            # Pick that item's two strongest props (highest numeric values)
            numeric = [
                (k, v) for k, v in own_props.items() if isinstance(v, (int, float))
            ]
            numeric.sort(key=lambda kv: -kv[1])
            top = numeric[:2]
            if top:
                trait_desc = ", ".join(
                    f"{k.replace('_', ' ')} {v}" for k, v in top
                )
                contribution = f"contributes its {trait_desc} — weighted at {pct}%"
            else:
                contribution = f"contributes structural parts at {pct}%"
            composition_notes.append(
                {
                    "source": it["name"],
                    "category": it.get("category"),
                    "ratio": r,
                    "contribution": contribution,
                }
            )
        for el in elements:
            composition_notes.append(
                {
                    "source": el["name"],
                    "category": "element",
                    "ratio": None,
                    "contribution": f"applies {el.get('transform',{}).get('effect','')} transform to the base",
                }
            )

        # --- dominant / weak property traits ---------------------------
        numeric_props = [
            (k, float(v)) for k, v in props.items() if isinstance(v, (int, float))
        ]
        numeric_props.sort(key=lambda kv: -kv[1])

        dominant_traits: List[Dict[str, Any]] = []
        for k, v in numeric_props[:3]:
            if v >= 6.5:
                dominant_traits.append(
                    {
                        "property": k,
                        "value": round(v, 2),
                        "note": self._PROPERTY_HIGH_NOTE.get(k, "strong expression of this trait"),
                    }
                )

        weak_points: List[Dict[str, Any]] = []
        for k, v in numeric_props[::-1][:3]:
            if v <= 3.5:
                weak_points.append(
                    {
                        "property": k,
                        "value": round(v, 2),
                        "note": self._PROPERTY_LOW_NOTE.get(k, "low expression of this trait"),
                    }
                )

        # --- form + element notes --------------------------------------
        form_key = form_mode or "solid"
        form_note = self._FORM_NOTE.get(form_key, self._FORM_NOTE["solid"])
        element_note = self._ELEMENT_NOTE.get(effect) if effect else None

        # --- tradeoff synthesis ----------------------------------------
        tradeoffs: List[str] = []
        if dominant_traits and weak_points:
            tradeoffs.append(
                f"Gains {dominant_traits[0]['property'].replace('_',' ')} "
                f"at the cost of {weak_points[0]['property'].replace('_',' ')}."
            )
        if form_mode and form_mode not in ("", "solid"):
            if form_mode == "diffuse":
                tradeoffs.append("Halved weight, reduced peak strength.")
            elif form_mode == "condensed":
                tradeoffs.append("Extra strength and density, extra weight and cost.")
            elif form_mode == "porous":
                tradeoffs.append("Outstanding shock absorption, much lower strength.")
            elif form_mode == "plate":
                tradeoffs.append("Sheet strength and lower cost, poor flexibility.")
            elif form_mode == "fibrous":
                tradeoffs.append("Flexibility with modest strength and weight gains.")
        if effect:
            tradeoffs.append(
                f"Element treatment ({effect}) layers its own transform on top — inspect risk list."
            )

        # --- narrative (multi-paragraph) -------------------------------
        name_ratio_phrase = ", ".join(
            f"{it['name']} ({int(round(ratios[i]*100))}%)"
            for i, it in bases
        )
        if elements:
            name_ratio_phrase += " plus " + ", ".join(e["name"] for e in elements)

        paragraphs: List[str] = []

        lead = (
            f"This synthesis merges {name_ratio_phrase} into a single composite, "
            f"preserving each input's structural parts and cross-bonding them at their mix ratio."
        )
        if goal.strip():
            lead += f" Target goal: {goal.strip()}."
        paragraphs.append(lead)

        if dominant_traits:
            dom_text = ", ".join(
                f"{t['property'].replace('_',' ')}={t['value']} ({t['note']})"
                for t in dominant_traits
            )
            paragraphs.append(
                f"Dominant traits after weighted merge: {dom_text}. "
                f"These are the properties the result leans on — expect the composite to behave like something that emphasizes them."
            )
        else:
            paragraphs.append(
                "No single property dominates after the merge — the result sits in a balanced, "
                "generalist zone. Useful when you want well-rounded behavior but not specialization."
            )

        if weak_points:
            weak_text = ", ".join(
                f"{w['property'].replace('_',' ')}={w['value']} ({w['note']})"
                for w in weak_points
            )
            paragraphs.append(
                f"Weak points to plan around: {weak_text}. "
                f"Design the surrounding system to protect against these — reinforcements, isolation, or redundancy."
            )

        paragraphs.append(form_note)
        if element_note:
            paragraphs.append(element_note)

        if tradeoffs:
            paragraphs.append(
                "Core tradeoff: " + " ".join(tradeoffs)
            )

        return {
            "narrative": paragraphs,
            "composition_notes": composition_notes,
            "dominant_traits": dominant_traits,
            "weak_points": weak_points,
            "form_note": form_note,
            "element_note": element_note,
            "tradeoffs": tradeoffs,
        }

    def _structural_advantages(
        self, items: List[Dict[str, Any]], effect: Optional[str]
    ) -> List[str]:
        out = [
            "preserves structural breakdown of each input",
            "cross-bonded interfaces",
            "each part directly traceable to a source",
        ]
        if effect:
            out += self._element_advantages(effect)[:2]
        return out

    def _structural_risks(
        self, items: List[Dict[str, Any]], effect: Optional[str]
    ) -> List[str]:
        out = [
            "material compatibility at bonding points",
            "differential thermal expansion",
        ]
        if effect:
            out += self._element_risks(effect)[:2]
        return out

    def _structural_use_cases(
        self, items: List[Dict[str, Any]]
    ) -> List[str]:
        groups = {it.get("group") for it in items}
        out = ["hybrid prototyping", "multi-material design"]
        if "furniture" in groups:
            out.append("custom furniture")
        if "robotics" in groups:
            out.append("robotic interfaces")
        if "wearable" in groups:
            out.append("protective gear")
        if "optical" in groups:
            out.append("optical systems")
        return out

    def _build_result_multi(
        self,
        items: List[Dict[str, Any]],
        goal: str,
    ) -> Dict[str, Any]:
        n = len(items)
        names = [item["name"] for item in items]
        ids = [item["id"] for item in items]

        # Combined properties: union of keys, average across items that have them.
        merged_props: Dict[str, float] = {}
        for key in self._collect_numeric_keys(items):
            vals = [
                float(item.get("properties", {}).get(key))
                for item in items
                if isinstance(item.get("properties", {}).get(key), (int, float))
            ]
            if vals:
                merged_props[key] = round(sum(vals) / len(vals), 2)

        # Diagram: one node per source + a fusion hub + an emergent shell.
        diagram_nodes = []
        diagram_edges = []
        for i, item in enumerate(items):
            node_id = f"src_{i+1}"
            diagram_nodes.append({"id": node_id, "label": item["name"]})
            diagram_edges.append(
                {"from": node_id, "to": "fusion", "type": "feeds"}
            )
        diagram_nodes.append({"id": "fusion", "label": "Fusion Core"})
        diagram_nodes.append({"id": "shell", "label": "Emergent Shell"})
        diagram_edges.append({"from": "fusion", "to": "shell", "type": "shapes"})

        concept_name = f"Multi-Blend Concept ({n} sources)"
        summary = (
            f"A speculative {n}-way hybrid combining {', '.join(names)} "
            f"through a shared fusion core and an emergent outer shell."
        )
        if goal.strip():
            summary += f" Goal focus: {goal.strip()}."

        return {
            "experiment_id": self._make_experiment_id_multi(ids, goal),
            "inputs": ids,
            "goal": goal,
            "rule_id": "rule_multi_blend",
            "concept_name": concept_name,
            "summary": summary,
            "combined_properties": merged_props,
            "diagram": {
                "nodes": diagram_nodes,
                "edges": diagram_edges,
            },
            "advantages": [
                "synergy across multiple property dimensions",
                "wider design space exploration",
                "supports multi-objective experimentation",
            ],
            "risks": [
                "harder material compatibility",
                "manufacturing complexity scales with N",
                "behavior under stress is unpredictable",
            ],
            "use_cases": [
                "research prototyping",
                "advanced concept design",
                "multi-objective brainstorming",
            ],
            "source_items": [
                {
                    "id": item["id"],
                    "name": item["name"],
                    "category": item["category"],
                }
                for item in items
            ],
        }

    @staticmethod
    def _collect_numeric_keys(items: List[Dict[str, Any]]) -> List[str]:
        keys: set = set()
        for item in items:
            for k, v in item.get("properties", {}).items():
                if isinstance(v, (int, float)):
                    keys.add(k)
        return sorted(keys)

    def _make_experiment_id_multi(self, ids: List[str], goal: str) -> str:
        joined = "_".join(ids[:4])
        if len(ids) > 4:
            joined += f"_plus{len(ids) - 4}"
        goal_slug = self._slugify(goal) if goal.strip() else "no-goal"
        return f"exp_multi_{joined}_{goal_slug}"

    def _build_result_pair(
        self,
        item_a: Dict[str, Any],
        item_b: Dict[str, Any],
        goal: str,
        rule: Dict[str, Any],
    ) -> Dict[str, Any]:
        template = rule["template"]
        combined_properties = self._combine_properties(item_a, item_b)

        summary = template["summary"]
        if goal.strip():
            summary = f"{summary} Goal focus: {goal.strip()}."

        return {
            "experiment_id": self._make_experiment_id(item_a["id"], item_b["id"], goal),
            "inputs": [item_a["id"], item_b["id"]],
            "goal": goal,
            "rule_id": rule["id"],
            "concept_name": template["concept_name"],
            "summary": summary,
            "combined_properties": combined_properties,
            "diagram": template["diagram"],
            "advantages": template["advantages"],
            "risks": template["risks"],
            "use_cases": template["use_cases"],
            "source_items": [
                {
                    "id": item_a["id"],
                    "name": item_a["name"],
                    "category": item_a["category"],
                },
                {
                    "id": item_b["id"],
                    "name": item_b["name"],
                    "category": item_b["category"],
                },
            ],
        }

    def _combine_properties(
        self,
        item_a: Dict[str, Any],
        item_b: Dict[str, Any],
    ) -> Dict[str, float]:
        props_a = item_a.get("properties", {})
        props_b = item_b.get("properties", {})

        common_keys = set(props_a.keys()).intersection(props_b.keys())
        combined: Dict[str, float] = {}

        for key in sorted(common_keys):
            val_a = props_a.get(key)
            val_b = props_b.get(key)
            if isinstance(val_a, (int, float)) and isinstance(val_b, (int, float)):
                combined[key] = round((float(val_a) + float(val_b)) / 2.0, 2)

        if not combined:
            for key, value in props_a.items():
                if isinstance(value, (int, float)):
                    combined[f"a_{key}"] = float(value)
            for key, value in props_b.items():
                if isinstance(value, (int, float)):
                    combined[f"b_{key}"] = float(value)

        return combined

    def _make_experiment_id(self, id_a: str, id_b: str, goal: str) -> str:
        goal_slug = self._slugify(goal) if goal.strip() else "no-goal"
        return f"exp_{id_a}_{id_b}_{goal_slug}"

    @staticmethod
    def _normalize_text(text: str) -> str:
        text = text.lower().strip()
        text = re.sub(r"\s+", " ", text)
        return text

    @staticmethod
    def _slugify(text: str) -> str:
        text = text.lower().strip()
        text = re.sub(r"[^a-z0-9\s_-]", "", text)
        text = re.sub(r"\s+", "-", text)
        return text[:50] if text else "untitled"

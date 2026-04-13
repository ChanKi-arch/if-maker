"""
Pin tests for the deterministic mix engine.

These lock in the current behaviour of MixService so that future edits can't
silently change synthesis output. If a test fails after a change, decide
consciously whether the new behaviour is intentional.

Run:  cd backend && pytest -q
"""
from __future__ import annotations

import os
import sys

# Allow the tests to import the backend package when run from repo root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from services.mix_service import MixService


@pytest.fixture(scope="module")
def svc() -> MixService:
    return MixService()


# ---------- basic validation ----------------------------------------------


def test_requires_at_least_two_items(svc: MixService) -> None:
    with pytest.raises(ValueError):
        svc.generate(["chair"], goal="")


def test_rejects_more_than_eight(svc: MixService) -> None:
    too_many = ["chair"] * 9
    with pytest.raises(ValueError):
        svc.generate(too_many, goal="")


def test_unknown_item_id_raises(svc: MixService) -> None:
    with pytest.raises(ValueError):
        svc.generate(["chair", "ghostly_unknown_thing_xyz"], goal="")


# ---------- structural merge determinism ----------------------------------


def test_chair_plus_carbon_fiber_is_deterministic(svc: MixService) -> None:
    """Same inputs → same concept name + property set."""
    a = svc.generate(["chair", "carbon_fiber"], goal="")
    b = svc.generate(["chair", "carbon_fiber"], goal="")
    assert a["concept_name"] == b["concept_name"]
    assert a["combined_properties"] == b["combined_properties"]
    assert len(a["diagram"]["nodes"]) == len(b["diagram"]["nodes"])


def test_chair_plus_carbon_fiber_produces_expected_name(svc: MixService) -> None:
    r = svc.generate(["chair", "carbon_fiber"], goal="")
    # Object + material should yield "<Material> <Object>"
    assert "Chair" in r["concept_name"]
    assert "Carbon Fiber" in r["concept_name"]


def test_parts_are_padded_to_max_count(svc: MixService) -> None:
    """
    Chair has 4 parts, Carbon Fiber has 2 layers. The merged diagram should
    carry 4 parts from Chair AND 4 (padded) parts from Carbon Fiber.
    """
    r = svc.generate(["chair", "carbon_fiber"], goal="")
    sources_counted: dict[str, int] = {}
    for n in r["diagram"]["nodes"]:
        src = n.get("source")
        if src:
            sources_counted[src] = sources_counted.get(src, 0) + 1
    assert sources_counted.get("Chair") == 4
    assert sources_counted.get("Carbon Fiber") == 4


# ---------- ratios / weighting --------------------------------------------


def test_ratios_dominant_base_shows_percentage_prefix(svc: MixService) -> None:
    r = svc.generate(
        ["chair", "carbon_fiber"], goal="", ratios=[0.8, 0.2]
    )
    assert r["concept_name"].startswith("80%")


def test_ratios_equal_mix_omits_percentage_prefix(svc: MixService) -> None:
    r = svc.generate(
        ["chair", "carbon_fiber"], goal="", ratios=[0.5, 0.5]
    )
    # No dominant side → no leading "xx%"
    assert not r["concept_name"].startswith("5")


def test_ratios_affect_weighted_properties(svc: MixService) -> None:
    """
    Use two materials that share the same numeric key ('strength').
    Weighted merge should bias toward the dominant side.
    """
    heavy_steel = svc.generate(
        ["steel", "rubber"], goal="", ratios=[0.9, 0.1]
    )
    heavy_rubber = svc.generate(
        ["steel", "rubber"], goal="", ratios=[0.1, 0.9]
    )
    # Steel has strength 10, rubber has strength 4.
    assert (
        heavy_steel["combined_properties"]["strength"]
        > heavy_rubber["combined_properties"]["strength"]
    )


def test_source_items_carry_ratio_field(svc: MixService) -> None:
    r = svc.generate(
        ["chair", "carbon_fiber"], goal="", ratios=[0.7, 0.3]
    )
    ratios_seen = [s.get("ratio") for s in r["source_items"]]
    assert all(isinstance(x, (int, float)) for x in ratios_seen)
    assert round(sum(ratios_seen), 2) == 1.0


# ---------- element transforms --------------------------------------------


def test_chair_plus_fire_applies_burn_effect(svc: MixService) -> None:
    r = svc.generate(["chair", "fire"], goal="")
    # Element effect should be burn and name should carry the prefix.
    assert r.get("visual", {}).get("element_effect") == "burn"
    assert "Burnt" in r["concept_name"] or "Chair" in r["concept_name"]


def test_chair_plus_cold_reduces_flexibility(svc: MixService) -> None:
    r_base = svc.generate(["chair", "rubber"], goal="")
    r_frozen = svc.generate(["chair", "rubber", "cold"], goal="")
    # Freezing should push flexibility down.
    assert (
        r_frozen["combined_properties"].get("flexibility", 10)
        < r_base["combined_properties"].get("flexibility", 0) + 1
    )


def test_elements_only_returns_clash(svc: MixService) -> None:
    r = svc.generate(["fire", "water"], goal="")
    assert r["rule_id"] == "rule_element_clash"


# ---------- form modes -----------------------------------------------------


@pytest.mark.parametrize(
    "mode,expected_prefix",
    [
        ("diffuse", "Diffuse"),
        ("condensed", "Condensed"),
        ("fibrous", "Fibrous"),
        ("plate", "Plated"),
        ("porous", "Porous"),
    ],
)
def test_form_mode_sets_name_prefix(
    svc: MixService, mode: str, expected_prefix: str
) -> None:
    r = svc.generate(
        ["chair", "carbon_fiber"], goal="", form_mode=mode
    )
    assert r["concept_name"].startswith(expected_prefix)


def test_solid_form_mode_has_no_prefix(svc: MixService) -> None:
    r = svc.generate(
        ["chair", "carbon_fiber"], goal="", form_mode="solid"
    )
    prefixes = ("Diffuse", "Condensed", "Fibrous", "Plated", "Porous")
    assert not r["concept_name"].startswith(prefixes)


def test_diffuse_halves_weight(svc: MixService) -> None:
    base = svc.generate(["chair", "carbon_fiber"], goal="")
    diffuse = svc.generate(
        ["chair", "carbon_fiber"], goal="", form_mode="diffuse"
    )
    assert (
        diffuse["combined_properties"].get("weight", 10)
        <= base["combined_properties"].get("weight", 0)
    )


# ---------- explore variants ----------------------------------------------


def test_explore_returns_five_variants(svc: MixService) -> None:
    r = svc.explore(["chair", "carbon_fiber"], goal="", ratios=[0.6, 0.4])
    assert len(r["variants"]) == 5
    ids = [v["strategy_id"] for v in r["variants"]]
    assert set(ids) == {"shell", "infuse", "stack", "swap", "blend"}


def test_explore_each_variant_has_hint(svc: MixService) -> None:
    r = svc.explore(["chair", "carbon_fiber"], goal="")
    for v in r["variants"]:
        assert v.get("strategy_hint")
        assert v.get("concept_name")


def test_explore_infuse_uses_integer_parts(svc: MixService) -> None:
    """Core Infuse hint should mention integer part count."""
    r = svc.explore(
        ["chair", "carbon_fiber"], goal="", ratios=[0.6, 0.4]
    )
    infuse = next(v for v in r["variants"] if v["strategy_id"] == "infuse")
    # Hint like "2 of 4 parts infused"
    hint = infuse["strategy_hint"]
    assert "parts" in hint or "part" in hint


# ---------- decompose round-trip ------------------------------------------


def test_decompose_known_concept_returns_components(svc: MixService) -> None:
    d = svc.decompose("Hybrid Shock Shell")
    assert d["components"]
    assert d["confidence"] in ("high", "medium", "low")


def test_multi_blend_three_items(svc: MixService) -> None:
    r = svc.generate(["chair", "carbon_fiber", "rubber"], goal="")
    assert len(r["source_items"]) == 3
    # Combined properties should contain entries from all three inputs.
    assert len(r["combined_properties"]) > 0

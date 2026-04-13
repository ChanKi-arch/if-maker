from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional

from services.mix_service import MixService
from services.llm_service import LLMService
from services.invention_service import InventionService

router = APIRouter(prefix="/mix", tags=["mix"])

llm_service = LLMService()
mix_service = MixService(llm_service=llm_service)
invention_service = InventionService(llm_service=llm_service)


class MixGenerateRequest(BaseModel):
    item_ids: List[str] = Field(..., min_length=2, max_length=8)
    goal: str = ""
    enhance: bool = False
    ratios: Optional[List[float]] = None
    form_mode: Optional[str] = None
    invent: bool = True
    check_prior_art: bool = True


class DecomposeRequest(BaseModel):
    concept_name: str = Field(..., min_length=1)
    goal: str = ""


class ExploreRequest(BaseModel):
    item_ids: List[str] = Field(..., min_length=2, max_length=8)
    goal: str = ""
    ratios: Optional[List[float]] = None
    form_mode: Optional[str] = None


@router.post("/generate")
def generate_mix(req: MixGenerateRequest):
    try:
        result = mix_service.generate(
            req.item_ids,
            req.goal,
            ratios=req.ratios,
            form_mode=req.form_mode,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if llm_service.is_enabled() and req.enhance:
        result = llm_service.enhance_mix_result(result)

    # Register the synthesis result as a first-class library item so it can
    # be re-selected, re-mixed, or chained into further syntheses.
    _register_synthesis_as_item(result)

    if req.invent:
        try:
            result["invention"] = invention_service.evaluate(
                result,
                req.goal,
                do_prior_art=req.check_prior_art,
                do_claim=True,
                persist=True,
            )
        except Exception as e:  # noqa: BLE001
            result["invention"] = {"error": f"{type(e).__name__}: {e}"}

    result["llm_available"] = llm_service.is_enabled()
    return result


@router.get("/inventions")
def list_inventions(limit: int = 50):
    return {"inventions": invention_service.list_inventions(limit=limit)}


@router.get("/inventions/{experiment_id}")
def get_invention(experiment_id: str):
    entry = invention_service.get_invention(experiment_id)
    if not entry:
        raise HTTPException(status_code=404, detail="invention not found")
    return entry


def _register_synthesis_as_item(result: dict) -> None:
    """Turn a synthesis result into a searchable item and inject it into the
    shared services (search / analysis / mix). Safe to call multiple times —
    later syntheses with the same id simply overwrite."""
    from routes.items import search_service, analysis_service  # late import to avoid cycle

    visual = result.get("visual") or {}
    effect = visual.get("element_effect")
    base_group = visual.get("base_group") or "hybrid"

    group = f"synthesis_{effect}" if effect else "synthesis"

    emoji_by_effect = {
        "burn": "🔥",
        "wet": "💧",
        "heat": "🌡️",
        "freeze": "❄️",
        "electrify": "⚡",
        "compress": "💨",
        "irradiate": "☢️",
        "vibrate": "🎵",
    }
    emoji = emoji_by_effect.get(effect or "", "⚗️")

    item = {
        "id": result["experiment_id"],
        "name": result["concept_name"],
        "category": "synthesized",
        "group": group,
        "emoji": emoji,
        "summary": result.get("summary", ""),
        "tags": ["synthesized", base_group]
        + [s.get("id", "") for s in result.get("source_items", [])],
        "properties": result.get("combined_properties", {}),
        "structure": {
            "type": "synthesized",
            "form": "concept",
            "layers": [
                n.get("label", "") for n in result.get("diagram", {}).get("nodes", [])
            ],
        },
        "uses": result.get("use_cases", []),
        "risks": result.get("risks", []),
        "synthesized": True,
        "source_items": result.get("source_items", []),
        "diagram": result.get("diagram"),
        "visual": visual,
    }

    # Only add to the user list if not already there (by id).
    existing = [i for i in search_service.user_items if i.get("id") == item["id"]]
    if not existing:
        search_service.add_user_item(item)
    analysis_service.items_by_id[item["id"]] = item
    mix_service.items_by_id[item["id"]] = item


@router.post("/explore")
def explore_mix(req: ExploreRequest):
    try:
        result = mix_service.explore(
            req.item_ids,
            req.goal,
            ratios=req.ratios,
            form_mode=req.form_mode,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


@router.post("/decompose")
def decompose_concept(req: DecomposeRequest):
    try:
        return mix_service.decompose(req.concept_name, req.goal)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/llm-status")
def llm_status():
    return {
        "enabled": llm_service.is_enabled(),
        "model": llm_service.model if llm_service.is_enabled() else None,
    }

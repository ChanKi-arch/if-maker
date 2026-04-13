from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional

from services.search_service import SearchService
from services.analysis_service import AnalysisService
from services.create_service import CreateService
from routes.mix import mix_service as shared_mix_service, llm_service as shared_llm_service

router = APIRouter(prefix="/items", tags=["items"])

search_service = SearchService()
analysis_service = AnalysisService()
create_service = CreateService(llm_service=shared_llm_service)


class CreateItemRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    hint: Optional[str] = None


@router.get("/search")
def search_items(
    q: str = Query(default=""),
    category: Optional[str] = Query(default=None),
    group: Optional[str] = Query(default=None),
):
    return {"items": search_service.search(q=q, category=category, group=group)}


@router.get("/groups")
def list_groups():
    return {"groups": search_service.list_groups()}


@router.post("/create")
def create_item(req: CreateItemRequest):
    try:
        item = create_service.create_item(req.name, req.hint)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Register the new item into every in-memory service so it's visible
    # in search, analyze, and mix.
    search_service.add_user_item(item)
    analysis_service.items_by_id[item["id"]] = item
    shared_mix_service.items_by_id[item["id"]] = item

    return item


@router.get("/{item_id}")
def get_item_detail(item_id: str):
    try:
        return analysis_service.analyze(item_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

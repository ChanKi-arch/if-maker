from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from typing import List, Optional
import json as _json

from services.export_service import ExportService
from routes.mix import mix_service

router = APIRouter(prefix="/export", tags=["export"])
export_service = ExportService()


class ExportRequest(BaseModel):
    item_ids: List[str] = Field(..., min_length=1)
    format: str = Field(default="unity")
    download: bool = True


def _collect(item_ids: List[str]) -> List[dict]:
    out: List[dict] = []
    for i in item_ids:
        it = mix_service.items_by_id.get(i)
        if it is None:
            raise HTTPException(status_code=404, detail=f"Unknown item: {i}")
        out.append(it)
    return out


@router.post("/unity")
def export_unity(req: ExportRequest):
    items = _collect(req.item_ids)
    payload = export_service.to_unity_scriptable_object(items)
    if req.download:
        body = _json.dumps(payload, indent=2, ensure_ascii=False)
        name = export_service.slugify(
            items[0].get("name") or items[0].get("concept_name") or "recipes"
        )
        return Response(
            content=body,
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="{name}_unity.json"',
            },
        )
    return payload


@router.post("/json")
def export_generic(req: ExportRequest):
    items = _collect(req.item_ids)
    payload = export_service.to_generic_json(items)
    if req.download:
        body = _json.dumps(payload, indent=2, ensure_ascii=False)
        name = export_service.slugify(
            items[0].get("name") or items[0].get("concept_name") or "recipes"
        )
        return Response(
            content=body,
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="{name}.json"',
            },
        )
    return payload


@router.post("/csv")
def export_csv(req: ExportRequest):
    items = _collect(req.item_ids)
    rows = export_service.to_flat_rows(items)
    if not rows:
        raise HTTPException(status_code=400, detail="Nothing to export")

    # Build CSV manually (keeps us off the csv module + escaping is simple)
    headers = list(rows[0].keys())
    lines = [",".join(headers)]
    for r in rows:
        vals = []
        for h in headers:
            v = r.get(h, "")
            if v is None:
                vals.append("")
                continue
            s = str(v).replace('"', '""')
            if "," in s or '"' in s or "\n" in s:
                s = f'"{s}"'
            vals.append(s)
        lines.append(",".join(vals))
    body = "\n".join(lines)

    name = export_service.slugify(
        items[0].get("name") or items[0].get("concept_name") or "recipes"
    )
    return Response(
        content=body,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{name}.csv"',
        },
    )


@router.get("/formats")
def list_formats():
    return {
        "formats": [
            {
                "id": "unity",
                "label": "Unity ScriptableObject JSON",
                "endpoint": "/export/unity",
                "extension": "json",
            },
            {
                "id": "json",
                "label": "Generic JSON",
                "endpoint": "/export/json",
                "extension": "json",
            },
            {
                "id": "csv",
                "label": "CSV (spreadsheet)",
                "endpoint": "/export/csv",
                "extension": "csv",
            },
        ]
    }

from __future__ import annotations

# Load .env before any service that reads environment variables.
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.items import router as items_router
from routes.mix import router as mix_router
from routes.export import router as export_router

app = FastAPI(
    title="IF Maker API",
    description="Open-source structured virtual lab backend",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(items_router)
app.include_router(mix_router)
app.include_router(export_router)


@app.get("/")
def root():
    return {
        "name": "IF Maker",
        "tagline": "Search → Analyze → Mix → Create",
        "status": "running",
        "version": "0.1.0",
    }


@app.get("/health")
def health():
    return {"status": "ok"}

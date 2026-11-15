"""MONETARY - Fixed Income & Monetary Policy Risk Terminal: FastAPI application."""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.config import settings
from app.data.sources import DataSourceError
from app.data.store import DataUnavailable

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(
    title="MONETARY - Fixed Income & Monetary Policy Risk Terminal",
    version="1.0.0",
    description="Quantitative fixed-income analytics API: Treasury curves, bond pricing, portfolio risk, "
    "monetary-policy scenarios, historical episodes and optimization.",
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.exception_handler(ValueError)
async def value_error_handler(_: Request, exc: ValueError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(KeyError)
async def key_error_handler(_: Request, exc: KeyError):
    return JSONResponse(status_code=404, content={"detail": f"not found: {exc.args[0] if exc.args else exc}"})


@app.exception_handler(DataUnavailable)
async def unavailable_handler(_: Request, exc: DataUnavailable):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(DataSourceError)
async def source_error_handler(_: Request, exc: DataSourceError):
    return JSONResponse(status_code=503, content={"detail": f"data source unavailable: {exc}"})


app.include_router(router)


@app.get("/")
def root():
    return {"name": "MONETARY API", "docs": "/docs", "health": "/api/health"}

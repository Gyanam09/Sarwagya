"""
main.py — Sarwagya FastAPI application entrypoint
"""
import logging
import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator
from contextlib import asynccontextmanager

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))

from app.core.config import settings
from app.core.database import connect_all, disconnect_all
from app.core.security import SECURITY_HEADERS
from app.api.v1.router import api_router

logging.basicConfig(
    level=logging.INFO if settings.APP_ENV == "production" else logging.DEBUG,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

# ── Sentry (free tier) ────────────────────────────────────────────────────

if settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        traces_sample_rate=0.1,   # 10% tracing to stay in free tier
        environment=settings.APP_ENV,
    )


# ── App lifespan (startup / shutdown) ─────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Sarwagya backend...")
    await connect_all()
    logger.info("All connections ready.")
    yield
    logger.info("Shutting down Sarwagya...")
    await disconnect_all()


# ── App init ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="Sarwagya API",
    description="Geopolitical Intelligence Platform — all-knowing.",
    version="0.1.0",
    docs_url="/docs" if settings.APP_ENV != "production" else None,
    redoc_url="/redoc" if settings.APP_ENV != "production" else None,
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    for key, value in SECURITY_HEADERS.items():
        response.headers[key] = value
    return response


@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"{request.method} {request.url.path}")
    response = await call_next(request)
    logger.info(f"→ {response.status_code}")
    return response


# ── Prometheus metrics (Grafana Cloud free) ───────────────────────────────

Instrumentator().instrument(app).expose(app, endpoint="/metrics")


# ── Routes ────────────────────────────────────────────────────────────────

app.include_router(api_router, prefix="/api/v1")


@app.get("/")
async def root():
    return {
        "name": "Sarwagya",
        "meaning": "All-knowing (सर्वज्ञ)",
        "version": "0.1.0",
        "status": "operational",
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}


# ── Global exception handler ──────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    import traceback
    return JSONResponse(
        status_code=500,
        content={
            "detail": f"Unhandled exception: {str(exc)}",
            "traceback": traceback.format_exc()
        },
    )

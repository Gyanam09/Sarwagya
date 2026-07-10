from fastapi import APIRouter
from app.api.v1.endpoints import (
    auth,
    countries,
    events,
    trade,
    forecasts,
    graph,
    reports,
    health,
    search,
)

api_router = APIRouter()

api_router.include_router(auth.router,      prefix="/auth",      tags=["auth"])
api_router.include_router(countries.router, prefix="/countries", tags=["countries"])
api_router.include_router(events.router,    prefix="/events",    tags=["events"])
api_router.include_router(trade.router,     prefix="/trade",     tags=["trade"])
api_router.include_router(forecasts.router, prefix="/forecasts", tags=["forecasts"])
api_router.include_router(graph.router,     prefix="/graph",     tags=["graph"])
api_router.include_router(reports.router,   prefix="/reports",   tags=["reports"])
api_router.include_router(health.router,    prefix="/health",    tags=["health"])
api_router.include_router(search.router,    prefix="/search",    tags=["search"])

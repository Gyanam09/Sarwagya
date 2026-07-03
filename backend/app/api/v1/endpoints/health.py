"""
health.py — System health endpoints
Used by uptime monitors (free tier like BetterStack/UptimeRobot)
and the self-healing agent.
"""
from fastapi import APIRouter, Depends
from app.core.database import get_db, get_neo4j_session, get_redis
from app.core.security import require_admin, TokenData
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


@router.get("/")
async def health_check():
    """Lightweight health check for uptime monitors — no auth required."""
    return {"status": "ok"}


@router.get("/deep")
async def deep_health_check(
    db: AsyncSession = Depends(get_db),
    neo4j=Depends(get_neo4j_session),
):
    """Check all downstream dependencies are reachable."""
    checks = {}

    try:
        await db.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception as e:
        checks["postgres"] = f"error: {str(e)}"

    try:
        result = await neo4j.run("RETURN 1 AS ok")
        await result.data()
        checks["neo4j"] = "ok"
    except Exception as e:
        checks["neo4j"] = f"error: {str(e)}"

    try:
        redis = get_redis()
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {str(e)}"

    overall = "healthy" if all(v == "ok" for v in checks.values()) else "degraded"
    return {"status": overall, "checks": checks}


@router.get("/system")
async def system_health(
    current_user: TokenData = Depends(require_admin),
):
    """
    Full system health including agent pipeline status.
    Admin only — surfaces the SelfHealingAgent's tracked component health.
    """
    # In production this would read from a shared health registry
    # (e.g. stored in Redis by the healer agent's background process)
    redis = get_redis()
    cached = await redis.get("system:health_registry")
    if cached:
        import json
        return json.loads(cached)
    return {"message": "No health data recorded yet. Healer agent may not be running."}

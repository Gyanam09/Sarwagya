"""
forecasts.py — Impact forecasting endpoints
Calls the Forecaster Agent on-demand for user queries like:
  "What happens if China bans rare earth exports to USA?"
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from app.core.security import require_analyst, check_rate_limit, TokenData
from app.core.database import get_neo4j_driver, get_redis
from app.core.config import settings
import json
import hashlib

router = APIRouter()


class ForecastRequest(BaseModel):
    event_description: str
    trigger_country_iso3: Optional[str] = None
    target_country_iso3: Optional[str] = None


@router.post("/predict")
async def predict_impact(
    body: ForecastRequest,
    current_user: TokenData = Depends(require_analyst),  # forecasting is analyst+ only
):
    """
    Generate an on-demand impact forecast for a hypothetical or real event.
    Restricted to analyst/admin roles since this consumes LLM API quota.
    """
    redis = get_redis()
    cache_key = "forecast:" + hashlib.md5(
        f"{body.event_description}{body.trigger_country_iso3}{body.target_country_iso3}".encode()
    ).hexdigest()
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    from agents.forecaster.main import ImpactForecaster

    forecaster = ImpactForecaster(
        groq_api_key=settings.GROQ_API_KEY,
        neo4j_driver=get_neo4j_driver(),
    )

    try:
        result = await forecaster.forecast(
            event_description=body.event_description,
            trigger_iso3=body.trigger_country_iso3,
            target_iso3=body.target_country_iso3,
        )
    except Exception as e:
        raise HTTPException(500, f"Forecast generation failed: {str(e)}")

    response = result.dict()
    # Cache for 1 hour — forecasts for the same query shouldn't regenerate constantly
    await redis.setex(cache_key, 3600, json.dumps(response, default=str))
    return response


@router.get("/scenarios/{event_id}")
async def get_event_forecast(
    event_id: str,
    _: TokenData = Depends(check_rate_limit),
):
    """Get a previously generated forecast for a known event (cached/stored)."""
    redis = get_redis()
    cache_key = f"event_forecast:{event_id}"
    cached = await redis.get(cache_key)
    if not cached:
        raise HTTPException(404, "No forecast available for this event yet")
    return json.loads(cached)

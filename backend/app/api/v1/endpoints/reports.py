"""
reports.py — Intelligence report generation endpoints
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.core.security import require_analyst, check_rate_limit, TokenData
from app.core.database import get_redis, get_neo4j_session
from app.core.config import settings
import json
import hashlib
import logging
from datetime import datetime

router = APIRouter()
logger = logging.getLogger(__name__)


class CountryBriefRequest(BaseModel):
    country_iso3: str


class BilateralBriefRequest(BaseModel):
    country_a_iso3: str
    country_b_iso3: str


@router.post("/country-brief")
async def generate_country_brief(
    body: CountryBriefRequest,
    neo4j=Depends(get_neo4j_session),
    current_user: TokenData = Depends(require_analyst),
):
    redis = get_redis()
    cache_key = f"report:country:{body.country_iso3}:{datetime.utcnow().date()}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    iso3 = body.country_iso3.upper()
    country_query = "MATCH (c:Country {iso3: $iso3}) RETURN c.name AS name"
    result = await neo4j.run(country_query, iso3=iso3)
    records = await result.data()
    if not records:
        raise HTTPException(404, f"Country '{iso3}' not found")
    country_name = records[0]["name"]

    events_result = await neo4j.run("""
        MATCH (c:Country {iso3: $iso3})-[:INVOLVED_IN]->(e:Event)
        WHERE e.date >= date() - duration({days: 30})
        RETURN e.title AS title, e.event_type AS event_type, e.severity AS severity,
               toString(e.date) AS date
        ORDER BY e.date DESC LIMIT 15
    """, iso3=iso3)
    recent_events = await events_result.data()

    rel_result = await neo4j.run("""
        MATCH (c:Country {iso3: $iso3})-[r]->(other:Country)
        RETURN type(r) AS relationship, other.iso3 AS partner, properties(r) AS props
        LIMIT 15
    """, iso3=iso3)
    relationships = await rel_result.data()

    try:
        from agents.reporter.main import ReportGenerator
        generator = ReportGenerator(
            groq_api_key=settings.GROQ_API_KEY,
            gemini_api_key=settings.GEMINI_API_KEY,
        )
        report = await generator.country_brief(
            country_iso3=iso3,
            country_name=country_name,
            indicators={},
            recent_events=recent_events,
            relationships=relationships,
        )
    except Exception as e:
        raise HTTPException(500, f"Report generation failed: {str(e)}")

    response = report.dict()
    await redis.setex(cache_key, 86400, json.dumps(response, default=str))
    return response


@router.post("/bilateral-brief")
async def generate_bilateral_brief(
    body: BilateralBriefRequest,
    neo4j=Depends(get_neo4j_session),
    current_user: TokenData = Depends(require_analyst),
):
    redis = get_redis()
    a, b = body.country_a_iso3.upper(), body.country_b_iso3.upper()
    cache_key = f"report:bilateral:{a}:{b}:{datetime.utcnow().date()}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    result = await neo4j.run(
        "MATCH (a:Country {iso3: $a}), (b:Country {iso3: $b}) RETURN a.name AS name_a, b.name AS name_b",
        a=a, b=b
    )
    records = await result.data()
    if not records:
        raise HTTPException(404, "One or both countries not found")
    name_a, name_b = records[0]["name_a"], records[0]["name_b"]

    rel_result = await neo4j.run(
        "MATCH (a:Country {iso3: $a})-[r]-(b:Country {iso3: $b}) RETURN type(r) AS relationship, properties(r) AS props",
        a=a, b=b
    )
    relationship_data = await rel_result.data()

    try:
        from agents.reporter.main import ReportGenerator
        generator = ReportGenerator(
            groq_api_key=settings.GROQ_API_KEY,
            gemini_api_key=settings.GEMINI_API_KEY,
        )
        report = await generator.bilateral_brief(
            country_a_iso3=a, country_a_name=name_a,
            country_b_iso3=b, country_b_name=name_b,
            relationship_data={"relationships": relationship_data},
        )
    except Exception as e:
        raise HTTPException(500, f"Report generation failed: {str(e)}")

    response = report.dict()
    await redis.setex(cache_key, 86400, json.dumps(response, default=str))
    return response


@router.get("/daily-digest")
async def get_daily_digest(
    neo4j=Depends(get_neo4j_session),
    _: TokenData = Depends(check_rate_limit),   # any logged-in user, no analyst gate
):
    """
    Get today's digest. Generates dynamically if not cached.
    Any authenticated user can access this — no analyst role required.
    """
    redis = get_redis()
    cache_key = f"digest:{datetime.utcnow().strftime('%Y-%m-%d')}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    logger.info("Digest cache miss — generating dynamically...")

    # Try to get events from Neo4j
    try:
        result = await neo4j.run("""
            MATCH (e:Event)
            WHERE e.date >= date() - duration({days: 30})
            OPTIONAL MATCH (c:Country)-[:INVOLVED_IN]->(e)
            RETURN e.event_id AS event_id, e.title AS title, e.event_type AS event_type,
                   e.severity AS severity, e.summary AS summary,
                   toString(e.date) AS date,
                   collect(DISTINCT c.iso3) AS countries_involved
            ORDER BY e.severity DESC LIMIT 15
        """)
        top_events = await result.data()
    except Exception as e:
        logger.warning(f"Neo4j query failed: {e}")
        top_events = []

    # Fallback seed events when graph is empty (early dev)
    if not top_events:
        today = datetime.utcnow().strftime("%Y-%m-%d")
        top_events = [
            {"title": "US Imposes New Tariffs on Chinese Electric Vehicles", "event_type": "TARIFF", "severity": 0.8, "summary": "The US announced significant tariff increases on Chinese EVs, solar panels, and critical minerals.", "date": today, "countries_involved": ["USA", "CHN"]},
            {"title": "Russia-India Energy Agreement Expands Crude Oil Shipments", "event_type": "TREATY", "severity": 0.65, "summary": "India and Russia signed a long-term energy cooperation treaty expanding oil shipments via the Northern Sea Route.", "date": today, "countries_involved": ["IND", "RUS"]},
            {"title": "Germany Suspends Coal Pipeline Operations", "event_type": "EMBARGO", "severity": 0.5, "summary": "Germany halted coal distribution corridors to meet emission standards, tightening Central European energy supply.", "date": today, "countries_involved": ["DEU"]},
            {"title": "Taiwan Strait Military Exercises Escalate Tensions", "event_type": "MILITARY_ACTION", "severity": 0.75, "summary": "China conducted live-fire military drills near Taiwan, raising concerns among regional allies and affecting semiconductor supply chains.", "date": today, "countries_involved": ["CHN", "TWN", "USA"]},
            {"title": "OPEC+ Announces Production Cut Extension", "event_type": "ECONOMIC_POLICY", "severity": 0.6, "summary": "OPEC+ agreed to extend voluntary production cuts, pushing crude oil prices higher and affecting import-dependent economies.", "date": today, "countries_involved": ["SAU", "RUS"]},
        ]

    try:
        from agents.reporter.main import ReportGenerator
        generator = ReportGenerator(
            groq_api_key=settings.GROQ_API_KEY,
            gemini_api_key=settings.GEMINI_API_KEY,
        )
        digest = await generator.daily_digest(top_events)
        digest_data = digest.dict()
        await redis.setex(cache_key, 86400, json.dumps(digest_data, default=str))
        return digest_data
    except Exception as e:
        logger.error(f"LLM digest generation failed: {e}")
        # Static fallback — always returns something useful
        return {
            "report_id": "fallback",
            "report_type": "DAILY_DIGEST",
            "title": f"Sarwagya Daily Intelligence Digest — {datetime.utcnow().strftime('%d %b %Y')}",
            "classification": "UNCLASSIFIED",
            "executive_summary": "Global geopolitical pressures are intensifying across multiple theatres. US-China trade tensions continue to reshape supply chains while energy markets remain volatile amid OPEC+ production management and Russia-India bilateral energy deals.",
            "sections": [{"heading": "Global Overview", "content": "Trade disputes, energy realignments, and regional military posturing are the dominant themes shaping the geopolitical landscape today.", "data_sources": ["GDELT", "NewsAPI"]}],
            "key_takeaways": [
                "US tariff escalations on Chinese EVs are accelerating supply chain diversification globally.",
                "Russia-India energy corridor expansion bypasses traditional Western-aligned shipping routes.",
                "Taiwan Strait tensions are directly impacting semiconductor supply chain risk premiums.",
                "OPEC+ production cuts are sustaining elevated crude oil prices into Q3.",
                "German energy transition is creating short-term power pricing volatility in Central Europe.",
            ],
            "risk_indicators": [
                {"indicator": "US-China Trade War", "level": "HIGH", "trend": "RISING"},
                {"indicator": "Energy Market Volatility", "level": "MEDIUM", "trend": "STABLE"},
                {"indicator": "Taiwan Strait Tensions", "level": "HIGH", "trend": "RISING"},
            ],
            "data_sources_used": ["GDELT", "NewsAPI", "World Bank"],
            "generated_at": datetime.utcnow().isoformat(),
            "model_used": "fallback-static",
            "confidence_note": "Static fallback digest. LLM generation temporarily unavailable.",
        }

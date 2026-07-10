"""
events.py — Geopolitical events endpoints
Trending/now returns seed data when Neo4j graph is empty (pre-pipeline).
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime
from app.core.security import check_rate_limit, TokenData
from app.core.database import get_neo4j_session, get_redis
import json

router = APIRouter()

# Seed events shown before Airflow pipeline populates Neo4j
SEED_EVENTS = [
    {"event_id": "seed_001", "title": "US Imposes New Tariffs on Chinese Electric Vehicles", "event_type": "TARIFF", "severity": 0.82, "summary": "Washington announced sweeping tariff hikes on Chinese EVs, solar panels, and semiconductors, escalating the ongoing trade war.", "source_url": "", "date": datetime.utcnow().strftime("%Y-%m-%d"), "affected_sectors": ["technology", "energy", "automotive"], "countries_involved": ["USA", "CHN"]},
    {"event_id": "seed_002", "title": "Taiwan Strait Military Exercises Escalate Regional Tensions", "event_type": "MILITARY_ACTION", "severity": 0.78, "summary": "China conducted large-scale live-fire drills near Taiwan, prompting US carrier group deployment to the region.", "source_url": "", "date": datetime.utcnow().strftime("%Y-%m-%d"), "affected_sectors": ["defense", "semiconductors", "shipping"], "countries_involved": ["CHN", "TWN", "USA"]},
    {"event_id": "seed_003", "title": "Russia-India Energy Agreement Expands Oil Corridor", "event_type": "TREATY", "severity": 0.65, "summary": "India and Russia signed a landmark energy cooperation pact expanding crude oil shipments via the Northern Sea Route.", "source_url": "", "date": datetime.utcnow().strftime("%Y-%m-%d"), "affected_sectors": ["energy", "trade"], "countries_involved": ["IND", "RUS"]},
    {"event_id": "seed_004", "title": "OPEC+ Extends Production Cuts Through Q3", "event_type": "ECONOMIC_POLICY", "severity": 0.61, "summary": "OPEC+ agreed to maintain voluntary production cuts, sustaining elevated crude oil prices and pressuring import-dependent economies.", "source_url": "", "date": datetime.utcnow().strftime("%Y-%m-%d"), "affected_sectors": ["energy", "finance"], "countries_involved": ["SAU", "RUS", "ARE"]},
    {"event_id": "seed_005", "title": "Germany Halts Coal Pipeline Operations Amid Climate Regulations", "event_type": "EMBARGO", "severity": 0.52, "summary": "Berlin suspended coal distribution corridors to meet EU emission targets, creating short-term energy supply pressure across Central Europe.", "source_url": "", "date": datetime.utcnow().strftime("%Y-%m-%d"), "affected_sectors": ["energy", "agriculture"], "countries_involved": ["DEU"]},
    {"event_id": "seed_006", "title": "Iran Nuclear Talks Stall Over Enrichment Limits", "event_type": "DIPLOMATIC", "severity": 0.71, "summary": "Negotiations between Iran and Western powers collapsed over uranium enrichment thresholds, raising concerns about regional nuclear proliferation.", "source_url": "", "date": datetime.utcnow().strftime("%Y-%m-%d"), "affected_sectors": ["energy", "defense"], "countries_involved": ["IRN", "USA", "DEU", "FRA"]},
    {"event_id": "seed_007", "title": "India-Pakistan Ceasefire Holds Along Line of Control", "event_type": "DIPLOMATIC", "severity": 0.55, "summary": "A renewed ceasefire agreement between India and Pakistan has held for 60 days, easing tensions in the Kashmir region.", "source_url": "", "date": datetime.utcnow().strftime("%Y-%m-%d"), "affected_sectors": ["defense", "trade"], "countries_involved": ["IND", "PAK"]},
    {"event_id": "seed_008", "title": "South China Sea Territorial Dispute Intensifies", "event_type": "CONFLICT", "severity": 0.69, "summary": "Philippine and Chinese coast guard vessels clashed near disputed shoals, prompting diplomatic protests and US security guarantees.", "source_url": "", "date": datetime.utcnow().strftime("%Y-%m-%d"), "affected_sectors": ["shipping", "defense", "energy"], "countries_involved": ["PHL", "CHN", "USA"]},
]


class EventOut(BaseModel):
    event_id: str
    title: str
    event_type: str
    severity: float
    summary: Optional[str] = None
    source_url: Optional[str] = None
    date: str
    affected_sectors: List[str] = []
    countries_involved: List[str] = []


@router.get("/", response_model=List[EventOut])
async def list_events(
    event_type: Optional[str] = Query(None),
    min_severity: float = Query(0.0, ge=0.0, le=1.0),
    country: Optional[str] = Query(None),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    limit: int = Query(50, le=200),
    neo4j=Depends(get_neo4j_session),
    _: TokenData = Depends(check_rate_limit),
):
    conditions = ["e.severity >= $min_severity"]
    params: dict = {"min_severity": min_severity, "limit": limit}
    if event_type:
        conditions.append("e.event_type = $event_type")
        params["event_type"] = event_type.upper()
    if from_date:
        conditions.append("e.date >= date($from_date)")
        params["from_date"] = str(from_date)
    if to_date:
        conditions.append("e.date <= date($to_date)")
        params["to_date"] = str(to_date)
    where_clause = " AND ".join(conditions)
    if country:
        query = f"""
        MATCH (c:Country {{iso3: $country}})-[:INVOLVED_IN]->(e:Event)
        WHERE {where_clause}
        OPTIONAL MATCH (other:Country)-[:INVOLVED_IN]->(e)
        RETURN e.event_id AS event_id, e.title AS title, e.event_type AS event_type,
               e.severity AS severity, e.summary AS summary, e.source_url AS source_url,
               toString(e.date) AS date, e.affected_sectors AS affected_sectors,
               collect(DISTINCT other.iso3) AS countries_involved
        ORDER BY e.date DESC, e.severity DESC LIMIT $limit
        """
        params["country"] = country.upper()
    else:
        query = f"""
        MATCH (e:Event) WHERE {where_clause}
        OPTIONAL MATCH (c:Country)-[:INVOLVED_IN]->(e)
        RETURN e.event_id AS event_id, e.title AS title, e.event_type AS event_type,
               e.severity AS severity, e.summary AS summary, e.source_url AS source_url,
               toString(e.date) AS date, e.affected_sectors AS affected_sectors,
               collect(DISTINCT c.iso3) AS countries_involved
        ORDER BY e.date DESC, e.severity DESC LIMIT $limit
        """
    result = await neo4j.run(query, params)
    records = await result.data()
    return records if records else [e for e in SEED_EVENTS if e["severity"] >= min_severity][:limit]


@router.get("/{event_id}", response_model=EventOut)
async def get_event(
    event_id: str,
    neo4j=Depends(get_neo4j_session),
    _: TokenData = Depends(check_rate_limit),
):
    query = """
    MATCH (e:Event {event_id: $event_id})
    OPTIONAL MATCH (c:Country)-[:INVOLVED_IN]->(e)
    RETURN e.event_id AS event_id, e.title AS title, e.event_type AS event_type,
           e.severity AS severity, e.summary AS summary, e.source_url AS source_url,
           toString(e.date) AS date, e.affected_sectors AS affected_sectors,
           collect(DISTINCT c.iso3) AS countries_involved
    """
    result = await neo4j.run(query, event_id=event_id)
    records = await result.data()
    if not records:
        seed = next((e for e in SEED_EVENTS if e["event_id"] == event_id), None)
        if seed:
            return seed
        raise HTTPException(404, f"Event '{event_id}' not found")
    return records[0]


@router.get("/today/digest")
async def todays_digest(_: TokenData = Depends(check_rate_limit)):
    redis = get_redis()
    cache_key = f"digest:{datetime.utcnow().strftime('%Y-%m-%d')}"
    cached = await redis.get(cache_key)
    if not cached:
        raise HTTPException(404, "Today's digest not yet generated.")
    return json.loads(cached)


@router.get("/trending/now")
async def trending_events(
    hours: int = Query(24, le=168),
    limit: int = Query(10, le=50),
    neo4j=Depends(get_neo4j_session),
    _: TokenData = Depends(check_rate_limit),
):
    """Trending events. Falls back to seed data when graph is empty."""
    query = """
    MATCH (e:Event)
    WHERE e.date >= date() - duration({hours: $hours})
    OPTIONAL MATCH (c:Country)-[:INVOLVED_IN]->(e)
    RETURN e.event_id AS event_id, e.title AS title, e.event_type AS event_type,
           e.severity AS severity, e.summary AS summary,
           toString(e.date) AS date,
           collect(DISTINCT c.iso3) AS countries_involved
    ORDER BY e.severity DESC LIMIT $limit
    """
    result = await neo4j.run(query, hours=hours, limit=limit)
    records = await result.data()
    # Return seed events when graph is empty
    return records if records else sorted(SEED_EVENTS, key=lambda e: e["severity"], reverse=True)[:limit]
"""
countries.py — Country data endpoints
Serves country profiles, relationships, and indicators.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from app.core.security import get_current_user, check_rate_limit, TokenData
from app.core.database import get_neo4j_session, get_redis
from app.services.country_service import CountryService
import json

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────

class CountryProfile(BaseModel):
    iso3: str
    name: str
    region: str
    population: Optional[int]
    gdp_usd: Optional[float]
    gdp_growth: Optional[float]
    trade_openness: Optional[float]
    political_stability: Optional[float]
    democracy_score: Optional[float]


class RelationshipSummary(BaseModel):
    country_a: str
    country_b: str
    trade_volume_usd: Optional[float]
    fdi_from_a_to_b: Optional[float]
    political_alignment_score: Optional[float]
    alliance: Optional[str]
    sanctions_active: bool
    last_updated: str


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.get("/", response_model=List[CountryProfile])
async def list_countries(
    region: Optional[str] = Query(None, description="Filter by region"),
    search: Optional[str] = Query(None, description="Search by name or ISO3"),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    _: TokenData = Depends(check_rate_limit),
):
    """List all countries with basic profiles."""
    redis = get_redis()
    cache_key = f"countries:list:{region}:{search}:{limit}:{offset}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    service = CountryService()
    countries = await service.get_all(region=region, search=search, limit=limit, offset=offset)

    await redis.setex(cache_key, 3600, json.dumps([c.dict() for c in countries]))
    return countries


@router.get("/{iso3}", response_model=CountryProfile)
async def get_country(
    iso3: str,
    _: TokenData = Depends(check_rate_limit),
):
    """Get detailed profile for a single country."""
    redis = get_redis()
    cache_key = f"country:{iso3.upper()}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    service = CountryService()
    country = await service.get_by_iso3(iso3.upper())
    if not country:
        raise HTTPException(404, f"Country '{iso3}' not found")

    await redis.setex(cache_key, 3600, json.dumps(country.dict()))
    return country


@router.get("/{iso3}/relationships")
async def get_relationships(
    iso3: str,
    relationship_type: Optional[str] = Query(
        None,
        description="Filter: TRADES_WITH | INVESTS_IN | ALLY_OF | SANCTIONS | CONFLICT_WITH"
    ),
    limit: int = Query(20, le=100),
    neo4j=Depends(get_neo4j_session),
    _: TokenData = Depends(check_rate_limit),
):
    """
    Get all relationships for a country from the knowledge graph.
    Returns Neo4j graph data.
    """
    iso3 = iso3.upper()
    if relationship_type:
        query = """
        MATCH (a:Country {iso3: $iso3})-[r:%s]->(b:Country)
        RETURN a.iso3 AS from, type(r) AS rel, b.iso3 AS to, properties(r) AS props
        LIMIT $limit
        """ % relationship_type.upper()
    else:
        query = """
        MATCH (a:Country {iso3: $iso3})-[r]->(b:Country)
        RETURN a.iso3 AS from, type(r) AS rel, b.iso3 AS to, properties(r) AS props
        LIMIT $limit
        """
    result = await neo4j.run(query, iso3=iso3, limit=limit)
    records = await result.data()
    return {"country": iso3, "relationships": records, "count": len(records)}


@router.get("/{iso3}/indicators")
async def get_indicators(
    iso3: str,
    years: int = Query(10, le=30, description="Number of years of history"),
    _: TokenData = Depends(check_rate_limit),
):
    """Get time-series economic indicators for a country (World Bank data)."""
    from app.services.worldbank_service import WorldBankService
    redis = get_redis()
    cache_key = f"indicators:{iso3}:{years}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    service = WorldBankService()
    data = await service.get_indicators(iso3.upper(), years=years)
    await redis.setex(cache_key, 86400, json.dumps(data))  # cache 24h
    return data


@router.get("/{iso3}/trade-partners")
async def get_trade_partners(
    iso3: str,
    top_n: int = Query(10, le=50),
    year: Optional[int] = Query(None),
    _: TokenData = Depends(check_rate_limit),
):
    """Get top trade partners from UN Comtrade data."""
    from app.services.comtrade_service import ComtradeService
    redis = get_redis()
    cache_key = f"trade_partners:{iso3}:{top_n}:{year}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    service = ComtradeService()
    data = await service.get_top_partners(iso3.upper(), top_n=top_n, year=year)
    await redis.setex(cache_key, 86400, json.dumps(data))
    return data

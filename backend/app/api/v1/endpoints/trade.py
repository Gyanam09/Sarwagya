"""
trade.py — Trade & economic relationship endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from app.core.security import check_rate_limit, TokenData
from app.core.database import get_neo4j_session, get_redis
import json

router = APIRouter()


class TradeFlow(BaseModel):
    reporter: str
    partner: str
    year: int
    exports_usd: Optional[float] = None
    imports_usd: Optional[float] = None
    trade_balance: Optional[float] = None
    top_commodities: List[str] = []


@router.get("/{iso3_a}/{iso3_b}", response_model=TradeFlow)
async def get_bilateral_trade(
    iso3_a: str,
    iso3_b: str,
    neo4j=Depends(get_neo4j_session),
    _: TokenData = Depends(check_rate_limit),
):
    """Get bilateral trade data between two countries from the knowledge graph."""
    query = """
    MATCH (a:Country {iso3: $a})-[r:TRADES_WITH]->(b:Country {iso3: $b})
    RETURN a.iso3 AS reporter, b.iso3 AS partner, r.year AS year,
           r.exports_usd AS exports_usd, r.imports_usd AS imports_usd,
           r.trade_balance AS trade_balance, r.top_commodities AS top_commodities
    ORDER BY r.year DESC
    LIMIT 1
    """
    result = await neo4j.run(query, a=iso3_a.upper(), b=iso3_b.upper())
    records = await result.data()
    if not records:
        raise HTTPException(404, f"No trade data found between {iso3_a} and {iso3_b}")
    return records[0]


@router.get("/{iso3}/network")
async def get_trade_network(
    iso3: str,
    min_value_usd: float = Query(0, description="Filter trades below this value"),
    limit: int = Query(30, le=100),
    neo4j=Depends(get_neo4j_session),
    _: TokenData = Depends(check_rate_limit),
):
    """Get a country's full trade network — for visualization."""
    query = """
    MATCH (a:Country {iso3: $iso3})-[r:TRADES_WITH]->(b:Country)
    WHERE r.exports_usd >= $min_value
    RETURN b.iso3 AS partner, b.name AS partner_name,
           r.exports_usd AS exports_usd, r.imports_usd AS imports_usd,
           r.top_commodities AS top_commodities
    ORDER BY r.exports_usd DESC
    LIMIT $limit
    """
    result = await neo4j.run(query, iso3=iso3.upper(), min_value=min_value_usd, limit=limit)
    records = await result.data()
    return {"country": iso3.upper(), "trade_partners": records}


@router.get("/commodity/{commodity}/exposure")
async def commodity_exposure(
    commodity: str,
    limit: int = Query(20, le=50),
    neo4j=Depends(get_neo4j_session),
    _: TokenData = Depends(check_rate_limit),
):
    """
    Find which countries are most exposed to supply shocks
    in a specific commodity (e.g. 'rare_earths', 'semiconductors').
    """
    redis = get_redis()
    cache_key = f"commodity_exposure:{commodity}:{limit}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    query = """
    MATCH (importer:Country)-[r:TRADES_WITH]->(exporter:Country)
    WHERE $commodity IN r.top_commodities
    RETURN importer.iso3 AS importer, exporter.iso3 AS exporter,
           r.imports_usd AS value
    ORDER BY r.imports_usd DESC
    LIMIT $limit
    """
    result = await neo4j.run(query, commodity=commodity, limit=limit)
    records = await result.data()
    response = {"commodity": commodity, "exposure": records}

    await redis.setex(cache_key, 86400, json.dumps(response))
    return response

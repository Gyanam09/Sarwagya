"""
graph.py — Knowledge graph query endpoints
Allows controlled Cypher-like queries for frontend visualizations.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from app.core.security import check_rate_limit, require_admin, TokenData
from app.core.database import get_neo4j_session

router = APIRouter()


@router.get("/network/{iso3}")
async def get_country_network(
    iso3: str,
    depth: int = Query(1, ge=1, le=3, description="Hops from center country"),
    neo4j=Depends(get_neo4j_session),
    _: TokenData = Depends(check_rate_limit),
):
    """
    Get the network graph around a country, for force-directed graph viz.
    depth=1 → direct relationships only
    depth=2 → relationships of relationships (use sparingly, free tier limits)
    """
    iso3 = iso3.upper()
    query = f"""
    MATCH path = (start:Country {{iso3: $iso3}})-[*1..{depth}]-(related:Country)
    WITH start, related, path
    LIMIT 300
    RETURN DISTINCT
      start.iso3 AS center,
      [n IN nodes(path) | {{iso3: n.iso3, name: n.name}}] AS nodes,
      [r IN relationships(path) | {{type: type(r), from: startNode(r).iso3, to: endNode(r).iso3}}] AS edges
    """
    result = await neo4j.run(query, iso3=iso3)
    records = await result.data()

    # Deduplicate nodes and edges for clean graph viz
    nodes_seen = {}
    edges_seen = set()
    for record in records:
        for n in record.get("nodes", []):
            nodes_seen[n["iso3"]] = n
        for e in record.get("edges", []):
            edge_key = (e["from"], e["to"], e["type"])
            edges_seen.add(edge_key)

    return {
        "center": iso3,
        "nodes": list(nodes_seen.values()),
        "edges": [{"from": f, "to": t, "type": ty} for f, t, ty in edges_seen],
    }


@router.get("/global")
async def get_global_graph(
    neo4j=Depends(get_neo4j_session),
    _: TokenData = Depends(check_rate_limit),
):
    """
    Return all country nodes + relationship edges for the global force-directed graph.
    Falls back to static seed data when Neo4j is empty.
    """
    # Seed graph data for pre-pipeline state
    SEED_NODES = [
        {"iso3": "USA", "name": "United States", "region": "Americas"},
        {"iso3": "CHN", "name": "China", "region": "Asia"},
        {"iso3": "RUS", "name": "Russia", "region": "Europe"},
        {"iso3": "IND", "name": "India", "region": "Asia"},
        {"iso3": "DEU", "name": "Germany", "region": "Europe"},
        {"iso3": "GBR", "name": "United Kingdom", "region": "Europe"},
        {"iso3": "FRA", "name": "France", "region": "Europe"},
        {"iso3": "JPN", "name": "Japan", "region": "Asia"},
        {"iso3": "SAU", "name": "Saudi Arabia", "region": "Middle East"},
        {"iso3": "IRN", "name": "Iran", "region": "Middle East"},
        {"iso3": "TWN", "name": "Taiwan", "region": "Asia"},
        {"iso3": "KOR", "name": "South Korea", "region": "Asia"},
        {"iso3": "BRA", "name": "Brazil", "region": "Americas"},
        {"iso3": "AUS", "name": "Australia", "region": "Oceania"},
        {"iso3": "PAK", "name": "Pakistan", "region": "Asia"},
        {"iso3": "TUR", "name": "Turkey", "region": "Europe"},
        {"iso3": "ARE", "name": "UAE", "region": "Middle East"},
        {"iso3": "ISR", "name": "Israel", "region": "Middle East"},
        {"iso3": "UKR", "name": "Ukraine", "region": "Europe"},
        {"iso3": "PHL", "name": "Philippines", "region": "Asia"},
    ]
    SEED_EDGES = [
        {"from": "USA", "to": "CHN", "type": "TRADES_WITH"},
        {"from": "USA", "to": "GBR", "type": "ALLY_OF"},
        {"from": "USA", "to": "JPN", "type": "ALLY_OF"},
        {"from": "USA", "to": "KOR", "type": "ALLY_OF"},
        {"from": "USA", "to": "AUS", "type": "ALLY_OF"},
        {"from": "USA", "to": "IRN", "type": "SANCTIONS"},
        {"from": "USA", "to": "RUS", "type": "SANCTIONS"},
        {"from": "CHN", "to": "RUS", "type": "TRADES_WITH"},
        {"from": "CHN", "to": "TWN", "type": "CONFLICT_WITH"},
        {"from": "CHN", "to": "IND", "type": "CONFLICT_WITH"},
        {"from": "RUS", "to": "UKR", "type": "CONFLICT_WITH"},
        {"from": "RUS", "to": "IND", "type": "TRADES_WITH"},
        {"from": "IND", "to": "PAK", "type": "CONFLICT_WITH"},
        {"from": "SAU", "to": "IRN", "type": "CONFLICT_WITH"},
        {"from": "SAU", "to": "USA", "type": "TRADES_WITH"},
        {"from": "ISR", "to": "IRN", "type": "CONFLICT_WITH"},
        {"from": "DEU", "to": "RUS", "type": "TRADES_WITH"},
        {"from": "JPN", "to": "CHN", "type": "TRADES_WITH"},
        {"from": "TWN", "to": "USA", "type": "TRADES_WITH"},
        {"from": "PHL", "to": "CHN", "type": "CONFLICT_WITH"},
    ]

    node_query = """
    MATCH (c:Country)
    RETURN c.iso3 AS iso3, c.name AS name, c.region AS region
    LIMIT 200
    """
    edge_query = """
    MATCH (a:Country)-[r]->(b:Country)
    RETURN a.iso3 AS from, type(r) AS type, b.iso3 AS to
    LIMIT 1000
    """
    try:
        node_result = await neo4j.run(node_query)
        nodes = await node_result.data()
        edge_result = await neo4j.run(edge_query)
        edges = await edge_result.data()
    except Exception:
        nodes, edges = [], []

    if not nodes:
        nodes = SEED_NODES
        edges = SEED_EDGES

    return {"nodes": nodes, "edges": edges}


@router.get("/stats")
async def graph_stats(
    neo4j=Depends(get_neo4j_session),
    _: TokenData = Depends(check_rate_limit),
):
    """Get overall knowledge graph statistics."""
    query = """
    MATCH (c:Country) WITH count(c) AS countries
    MATCH (e:Event) WITH countries, count(e) AS events
    MATCH ()-[r]->() WITH countries, events, count(r) AS relationships
    RETURN countries, events, relationships
    """
    result = await neo4j.run(query)
    records = await result.data()
    return records[0] if records else {"countries": 0, "events": 0, "relationships": 0}


@router.post("/query/raw")
async def raw_cypher_query(
    cypher: str,
    neo4j=Depends(get_neo4j_session),
    current_user: TokenData = Depends(require_admin),  # admin only — security critical
):
    """
    Execute a raw Cypher query. ADMIN ONLY.
    This is dangerous if exposed broadly — restricted to admin role
    and should additionally be disabled in production via feature flag.
    """
    # Block write operations even for admins via this endpoint
    forbidden = ["CREATE", "DELETE", "SET", "MERGE", "REMOVE", "DROP"]
    if any(kw in cypher.upper() for kw in forbidden):
        raise HTTPException(403, "Write operations not allowed via this endpoint")

    try:
        result = await neo4j.run(cypher)
        records = await result.data()
        return {"results": records, "count": len(records)}
    except Exception as e:
        raise HTTPException(400, f"Query error: {str(e)}")

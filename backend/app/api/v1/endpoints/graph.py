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

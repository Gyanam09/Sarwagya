"""
graph_updater/main.py — Knowledge Graph Agent for Sarwagya
Writes extracted entities & relations to Neo4j AuraDB (free tier).
Schema:
  Nodes: Country, Organization, Person, Event, Commodity, Treaty
  Edges: TRADES_WITH, INVESTS_IN, ALLY_OF, SANCTIONS, CONFLICT_WITH,
         SIGNS_TREATY, IMPOSES_TARIFF, MEMBER_OF, EXPORTS_TO, IMPORTS_FROM
"""
import logging
from datetime import datetime
from typing import Optional
from neo4j import AsyncDriver, AsyncGraphDatabase

logger = logging.getLogger(__name__)


# ── Neo4j schema setup ────────────────────────────────────────────────────

SCHEMA_QUERIES = [
    # Constraints (ensure uniqueness)
    "CREATE CONSTRAINT country_iso3 IF NOT EXISTS FOR (c:Country) REQUIRE c.iso3 IS UNIQUE",
    "CREATE CONSTRAINT event_id IF NOT EXISTS FOR (e:Event) REQUIRE e.event_id IS UNIQUE",
    "CREATE CONSTRAINT org_name IF NOT EXISTS FOR (o:Organization) REQUIRE o.name IS UNIQUE",

    # Indexes for fast lookup
    "CREATE INDEX country_name IF NOT EXISTS FOR (c:Country) ON (c.name)",
    "CREATE INDEX event_date IF NOT EXISTS FOR (e:Event) ON (e.date)",
    "CREATE INDEX event_type IF NOT EXISTS FOR (e:Event) ON (e.event_type)",
]


# ── Graph Updater ─────────────────────────────────────────────────────────

class GraphUpdater:
    def __init__(self, neo4j_uri: str, neo4j_user: str, neo4j_password: str):
        self.driver: AsyncDriver = AsyncGraphDatabase.driver(
            neo4j_uri,
            auth=(neo4j_user, neo4j_password),
            max_connection_pool_size=5,   # free tier limit
        )

    async def init_schema(self):
        """Create constraints and indexes on first run."""
        async with self.driver.session() as session:
            for query in SCHEMA_QUERIES:
                try:
                    await session.run(query)
                except Exception as e:
                    logger.warning(f"Schema init warning: {e}")
        logger.info("Neo4j schema initialized")

    async def upsert_country(self, country: dict):
        """
        Create or update a Country node.
        Uses MERGE to avoid duplicates.
        """
        query = """
        MERGE (c:Country {iso3: $iso3})
        SET c.name = $name,
            c.iso2 = $iso2,
            c.region = $region,
            c.subregion = $subregion,
            c.population = $population,
            c.capital = $capital,
            c.lat = $lat,
            c.lon = $lon,
            c.un_member = $un_member,
            c.updated_at = datetime()
        RETURN c.iso3 AS iso3
        """
        async with self.driver.session() as session:
            result = await session.run(query, **{
                "iso3": country.get("iso3", ""),
                "name": country.get("name", ""),
                "iso2": country.get("iso2", ""),
                "region": country.get("region", ""),
                "subregion": country.get("subregion", ""),
                "population": country.get("population"),
                "capital": country.get("capital", ""),
                "lat": country.get("lat"),
                "lon": country.get("lon"),
                "un_member": country.get("un_member", False),
            })
            return await result.data()

    async def upsert_all_countries(self, countries: list[dict]):
        """Batch upsert all countries."""
        for c in countries:
            if c.get("iso3"):
                await self.upsert_country(c)
        logger.info(f"Upserted {len(countries)} countries to Neo4j")

    async def create_event_node(self, event: dict) -> str:
        """Create an Event node and return its ID."""
        import hashlib
        event_id = hashlib.md5(
            f"{event.get('title','')}{event.get('date','')}".encode()
        ).hexdigest()[:16]

        query = """
        MERGE (e:Event {event_id: $event_id})
        SET e.title = $title,
            e.event_type = $event_type,
            e.severity = $severity,
            e.summary = $summary,
            e.source_url = $source_url,
            e.date = date($date),
            e.affected_sectors = $affected_sectors,
            e.created_at = datetime()
        RETURN e.event_id AS id
        """
        async with self.driver.session() as session:
            result = await session.run(query, {
                "event_id": event_id,
                "title": event.get("title", ""),
                "event_type": event.get("event_type", "OTHER"),
                "severity": event.get("severity", 0.0),
                "summary": event.get("summary", ""),
                "source_url": event.get("source_url", ""),
                "date": event.get("date", datetime.utcnow().strftime("%Y-%m-%d")),
                "affected_sectors": event.get("affected_sectors", []),
            })
            data = await result.data()
            return data[0]["id"] if data else event_id

    async def link_country_to_event(self, country_iso3: str, event_id: str, role: str = "INVOLVED_IN"):
        """Link a Country node to an Event node."""
        query = f"""
        MATCH (c:Country {{iso3: $iso3}})
        MATCH (e:Event {{event_id: $event_id}})
        MERGE (c)-[r:{role}]->(e)
        SET r.created_at = datetime()
        """
        async with self.driver.session() as session:
            await session.run(query, iso3=country_iso3, event_id=event_id)

    async def upsert_relationship(
        self,
        from_iso3: str,
        to_iso3: str,
        rel_type: str,
        properties: dict = None,
    ):
        """
        Create or update a relationship between two countries.
        rel_type: TRADES_WITH | SANCTIONS | ALLY_OF | CONFLICT_WITH | etc.
        """
        props = properties or {}
        props["updated_at"] = datetime.utcnow().isoformat()

        # Build dynamic property SET clause
        set_clauses = ", ".join(f"r.{k} = ${k}" for k in props)
        query = f"""
        MATCH (a:Country {{iso3: $from_iso3}})
        MATCH (b:Country {{iso3: $to_iso3}})
        MERGE (a)-[r:{rel_type}]->(b)
        SET {set_clauses if set_clauses else 'r.updated_at = datetime()'}
        RETURN type(r) AS rel
        """
        params = {"from_iso3": from_iso3, "to_iso3": to_iso3, **props}
        async with self.driver.session() as session:
            await session.run(query, params)

    async def upsert_trade_flow(
        self,
        reporter_iso3: str,
        partner_iso3: str,
        year: int,
        export_value_usd: float,
        import_value_usd: float,
        top_commodities: list[str] = None,
    ):
        """Update trade relationship with Comtrade data."""
        await self.upsert_relationship(
            from_iso3=reporter_iso3,
            to_iso3=partner_iso3,
            rel_type="TRADES_WITH",
            properties={
                "year": year,
                "exports_usd": export_value_usd,
                "imports_usd": import_value_usd,
                "top_commodities": top_commodities or [],
                "trade_balance": export_value_usd - import_value_usd,
            },
        )

    async def process_extraction_result(self, extraction: dict, source_meta: dict):
        """
        Full pipeline: take ExtractedResult dict → write to Neo4j.
        Called by the main agent loop.
        """
        event_id = await self.create_event_node({
            "title": source_meta.get("title", ""),
            "event_type": extraction.get("event_type", "OTHER"),
            "severity": extraction.get("severity", 0.1),
            "summary": extraction.get("summary", ""),
            "source_url": source_meta.get("source_url", ""),
            "date": datetime.utcnow().strftime("%Y-%m-%d"),
            "affected_sectors": extraction.get("affected_sectors", []),
        })

        # Link countries to event
        for entity in extraction.get("entities", []):
            if entity.get("type") == "COUNTRY" and entity.get("iso3"):
                await self.link_country_to_event(entity["iso3"], event_id, "INVOLVED_IN")

        # Write relations
        for rel in extraction.get("relations", []):
            subj_iso3 = self._resolve_iso3(rel.get("subject", ""))
            obj_iso3 = self._resolve_iso3(rel.get("object", ""))
            if subj_iso3 and obj_iso3:
                await self.upsert_relationship(
                    from_iso3=subj_iso3,
                    to_iso3=obj_iso3,
                    rel_type=rel.get("predicate", "RELATED_TO").upper().replace(" ", "_"),
                    properties={
                        "sentiment": rel.get("sentiment", 0.0),
                        "confidence": rel.get("confidence", 0.5),
                        "event_id": event_id,
                    },
                )

        logger.info(f"Graph updated for event {event_id}")
        return event_id

    def _resolve_iso3(self, name: str) -> Optional[str]:
        """Quick lookup — extend with full country map."""
        from agents.extractor.main import COUNTRY_ISO3
        return COUNTRY_ISO3.get(name.lower().strip())

    async def get_country_network(self, iso3: str, depth: int = 2) -> dict:
        """
        Get the full network around a country up to N hops.
        Used by the impact prediction agent.
        """
        query = """
        MATCH path = (start:Country {iso3: $iso3})-[*1..$depth]-(related:Country)
        RETURN
          [node IN nodes(path) | {iso3: node.iso3, name: node.name}] AS nodes,
          [rel IN relationships(path) | {type: type(rel), props: properties(rel)}] AS rels
        LIMIT 500
        """
        async with self.driver.session() as session:
            result = await session.run(query, iso3=iso3, depth=depth)
            records = await result.data()
        return {"center": iso3, "network": records}

    async def close(self):
        await self.driver.close()

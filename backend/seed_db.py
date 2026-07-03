"""
seed_db.py — Seed script to populate Neo4j and Redis for Sarwagya local development.
Creates country nodes, bilateral relationships, recent events, and today's daily digest.
"""
import os
import sys
import asyncio
import logging
from datetime import datetime, timedelta
import json
import hashlib

# Fix Python path to import from workspace root
from pathlib import Path
root_dir = Path(__file__).resolve().parent.parent
sys.path.append(str(root_dir))
sys.path.append(str(root_dir / "backend"))

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

from dotenv import load_dotenv
load_dotenv(dotenv_path=root_dir / "backend" / ".env")

from app.core.config import settings
from app.core.database import get_neo4j_driver, get_redis

# ── Data Definitions ──────────────────────────────────────────────────────

COUNTRIES = [
    {"iso3": "USA", "name": "United States", "iso2": "US", "region": "Americas", "subregion": "Northern America", "population": 331002651, "capital": "Washington D.C.", "lat": 38.0, "lon": -97.0, "un_member": True},
    {"iso3": "CHN", "name": "China", "iso2": "CN", "region": "Asia", "subregion": "Eastern Asia", "population": 1402112000, "capital": "Beijing", "lat": 35.0, "lon": 105.0, "un_member": True},
    {"iso3": "RUS", "name": "Russia", "iso2": "RU", "region": "Europe", "subregion": "Eastern Europe", "population": 145912025, "capital": "Moscow", "lat": 60.0, "lon": 100.0, "un_member": True},
    {"iso3": "IND", "name": "India", "iso2": "IN", "region": "Asia", "subregion": "Southern Asia", "population": 1380004385, "capital": "New Delhi", "lat": 20.0, "lon": 77.0, "un_member": True},
    {"iso3": "DEU", "name": "Germany", "iso2": "DE", "region": "Europe", "subregion": "Western Europe", "population": 83132799, "capital": "Berlin", "lat": 51.0, "lon": 9.0, "un_member": True},
    {"iso3": "LKA", "name": "Sri Lanka", "iso2": "LK", "region": "Asia", "subregion": "Southern Asia", "population": 21919000, "capital": "Colombo", "lat": 7.0, "lon": 81.0, "un_member": True},
    {"iso3": "BRA", "name": "Brazil", "iso2": "BR", "region": "Americas", "subregion": "South America", "population": 212559417, "capital": "Brasília", "lat": -10.0, "lon": -55.0, "un_member": True},
    {"iso3": "UKR", "name": "Ukraine", "iso2": "UA", "region": "Europe", "subregion": "Eastern Europe", "population": 44134693, "capital": "Kyiv", "lat": 49.0, "lon": 32.0, "un_member": True},
]

RELATIONSHIPS = [
    # US-China trade and tariffs
    {"from_iso3": "USA", "to_iso3": "CHN", "type": "TRADES_WITH", "props": {"exports_usd": 150000000000.0, "imports_usd": 450000000000.0, "year": 2025, "trade_balance": -300000000000.0}},
    {"from_iso3": "USA", "to_iso3": "CHN", "type": "CONFLICT_WITH", "props": {"sentiment": -0.85, "confidence": 0.9, "reason": "Trade war and technological containment"}},
    
    # US-Germany (Allies)
    {"from_iso3": "USA", "to_iso3": "DEU", "type": "ALLY_OF", "props": {"sentiment": 0.8, "confidence": 0.95, "framework": "NATO"}},
    {"from_iso3": "USA", "to_iso3": "DEU", "type": "TRADES_WITH", "props": {"exports_usd": 70000000000.0, "imports_usd": 110000000000.0, "year": 2025}},

    # Russia-Ukraine conflict
    {"from_iso3": "RUS", "to_iso3": "UKR", "type": "CONFLICT_WITH", "props": {"sentiment": -0.99, "confidence": 0.99, "reason": "Military conflict"}},
    
    # US/EU sanctions on Russia
    {"from_iso3": "USA", "to_iso3": "RUS", "type": "SANCTIONS", "props": {"severity": 0.95, "year": 2022, "type": "FINANCIAL_AND_ENERGY"}},
    {"from_iso3": "DEU", "to_iso3": "RUS", "type": "SANCTIONS", "props": {"severity": 0.9, "year": 2022, "type": "FINANCIAL_AND_ENERGY"}},

    # India-Russia energy trade and ties
    {"from_iso3": "IND", "to_iso3": "RUS", "type": "ALLY_OF", "props": {"sentiment": 0.6, "confidence": 0.8, "framework": "Bilateral Strategic Partnership"}},
    {"from_iso3": "IND", "to_iso3": "RUS", "type": "TRADES_WITH", "props": {"exports_usd": 4000000000.0, "imports_usd": 45000000000.0, "year": 2025, "reason": "Deeply discounted crude oil acquisitions"}},

    # China-Sri Lanka (investment and debt)
    {"from_iso3": "CHN", "to_iso3": "LKA", "type": "INVESTS_IN", "props": {"value_usd": 8000000000.0, "sector": "INFRASTRUCTURE", "reason": "Belt and Road Initiative"}},
    {"from_iso3": "CHN", "to_iso3": "LKA", "type": "TRADES_WITH", "props": {"exports_usd": 4500000000.0, "imports_usd": 250000000.0, "year": 2025}},

    # US-Brazil trade
    {"from_iso3": "USA", "to_iso3": "BRA", "type": "TRADES_WITH", "props": {"exports_usd": 48000000000.0, "imports_usd": 38000000000.0, "year": 2025}},
]

MOCK_EVENTS = [
    {
        "title": "US Imposes New Tariffs on Chinese Electric Vehicles and Solar Panels",
        "event_type": "TARIFF",
        "severity": 0.85,
        "summary": "The United States government announced a significant increase in tariffs on several Chinese import sectors, including electric vehicles (100% tariff), solar cells (50% tariff), and critical battery minerals (25% tariff), aimed at protecting domestic industries from subsidization.",
        "source_url": "https://www.reuters.com/business/us-new-tariffs-china-ev-solar-minerals",
        "countries_involved": ["USA", "CHN"]
    },
    {
        "title": "Russia-India Bilateral Energy Agreement Expands Crude Oil Shipments",
        "event_type": "TREATY",
        "severity": 0.68,
        "summary": "India and Russia signed a long-term energy cooperation treaty expanding oil shipments via the Northern Sea Route, securing cheaper energy reserves for New Delhi and providing critical export revenue for Moscow amidst Western sanctions.",
        "source_url": "https://www.bloomberg.com/news/russia-india-long-term-energy-deal",
        "countries_involved": ["IND", "RUS"]
    },
    {
        "title": "Germany Shuts Down Key Coal Pipelines Amid Environmental Strains",
        "event_type": "EMBARGO",
        "severity": 0.52,
        "summary": "Germany has halted transit through several coal distribution corridors to meet strict European emission standards, tightening immediate energy supply channels in Central Europe and causing pricing volatility.",
        "source_url": "https://www.spiegel.de/wirtschaft/germany-halts-coal-transit-corridors",
        "countries_involved": ["DEU"]
    },
    {
        "title": "China Restructures Sri Lanka Debt to Secure Colombo Port Terminal",
        "event_type": "EMBARGO",
        "severity": 0.74,
        "summary": "The Sri Lankan government reached a debt restructuring agreement with Chinese lenders, conceding long-term management access to Colombo Port's southern container terminal to settle pending credit balances under the Belt and Road framework.",
        "source_url": "https://www.economist.com/asia/sri-lanka-debt-china-port-restructure",
        "countries_involved": ["CHN", "LKA"]
    },
    {
        "title": "Brazil-US Trade Agreement Boosts Agricultural Shipments",
        "event_type": "TREATY",
        "severity": 0.45,
        "summary": "Brazil and the United States signed a mutual trade optimization treaty reducing sanitary-check timelines and customs processing delays for beef and soybean exports, boosting bilateral agricultural exchange volumes.",
        "source_url": "https://www.reuters.com/world/americas/brazil-us-sign-agri-trade-streamline",
        "countries_involved": ["BRA", "USA"]
    }
]

# ── Seeding Engine ────────────────────────────────────────────────────────

async def seed_neo4j():
    logger.info("Initializing Neo4j Driver...")
    driver = get_neo4j_driver()
    
    # 1. Clean existing database nodes and relationships
    logger.info("Cleaning up existing Neo4j graph nodes...")
    async with driver.session() as session:
        await session.run("MATCH (n) DETACH DELETE n")
        
        # 2. Setup schema constraints & indexes
        logger.info("Creating constraints and indexes...")
        schema_queries = [
            "CREATE CONSTRAINT country_iso3 IF NOT EXISTS FOR (c:Country) REQUIRE c.iso3 IS UNIQUE",
            "CREATE CONSTRAINT event_id IF NOT EXISTS FOR (e:Event) REQUIRE e.event_id IS UNIQUE",
            "CREATE CONSTRAINT org_name IF NOT EXISTS FOR (o:Organization) REQUIRE o.name IS UNIQUE",
            "CREATE INDEX country_name IF NOT EXISTS FOR (c:Country) ON (c.name)",
            "CREATE INDEX event_date IF NOT EXISTS FOR (e:Event) ON (e.date)",
            "CREATE INDEX event_type IF NOT EXISTS FOR (e:Event) ON (e.event_type)",
        ]
        for query in schema_queries:
            try:
                await session.run(query)
            except Exception as e:
                logger.warning(f"Constraint creation warning: {e}")

        # 3. Create Country nodes
        logger.info("Creating country nodes...")
        country_query = """
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
        """
        for country in COUNTRIES:
            await session.run(country_query, **country)
        logger.info(f"Seeded {len(COUNTRIES)} countries.")

        # 4. Create Relationships (Edges)
        logger.info("Creating country-to-country relationships...")
        for rel in RELATIONSHIPS:
            from_iso = rel["from_iso3"]
            to_iso = rel["to_iso3"]
            rel_type = rel["type"]
            props = rel["props"]
            props["updated_at"] = datetime.utcnow().isoformat()
            
            set_clauses = ", ".join(f"r.{k} = ${k}" for k in props)
            query = f"""
            MATCH (a:Country {{iso3: $from_iso}})
            MATCH (b:Country {{iso3: $to_iso}})
            MERGE (a)-[r:{rel_type}]->(b)
            SET {set_clauses}
            """
            await session.run(query, from_iso=from_iso, to_iso=to_iso, **props)
        logger.info(f"Seeded {len(RELATIONSHIPS)} relationships.")

        # 5. Create Events
        logger.info("Creating recent geopolitical events...")
        event_query = """
        MERGE (e:Event {event_id: $event_id})
        SET e.title = $title,
            e.event_type = $event_type,
            e.severity = $severity,
            e.summary = $summary,
            e.source_url = $source_url,
            e.date = date($date),
            e.created_at = datetime()
        """
        link_query = """
        MATCH (c:Country {iso3: $iso3})
        MATCH (e:Event {event_id: $event_id})
        MERGE (c)-[r:INVOLVED_IN]->(e)
        SET r.created_at = datetime()
        """
        
        seeded_events = []
        for index, event in enumerate(MOCK_EVENTS):
            # Create a deterministic event_id
            event_id = hashlib.md5(f"{event['title']}{event.get('source_url', '')}".encode()).hexdigest()[:16]
            
            # Position the event slightly in the past (e.g. 2 hours, 4 hours, etc.)
            event_date = (datetime.utcnow() - timedelta(hours=2 * index)).strftime("%Y-%m-%d")
            
            event_data = {
                "event_id": event_id,
                "title": event["title"],
                "event_type": event["event_type"],
                "severity": event["severity"],
                "summary": event["summary"],
                "source_url": event["source_url"],
                "date": event_date
            }
            
            await session.run(event_query, **event_data)
            
            # Link countries
            for iso in event["countries_involved"]:
                await session.run(link_query, iso3=iso, event_id=event_id)
                
            # Add formatted structure for reporter daily digest ingestion
            seeded_events.append({
                "title": event["title"],
                "url": event["source_url"],
                "classification": {
                    "event_type": event["event_type"],
                    "severity": event["severity"],
                    "summary": event["summary"]
                },
                "extraction": {
                    "entities": [{"name": c, "type": "COUNTRY", "iso3": c} for c in event["countries_involved"]],
                    "relations": []
                }
            })
            
        logger.info(f"Seeded {len(MOCK_EVENTS)} events and linked them to countries.")
        return seeded_events


async def seed_redis_digest(seeded_events):
    logger.info("Initializing Redis Client...")
    redis = get_redis()
    cache_key = f"digest:{datetime.utcnow().strftime('%Y-%m-%d')}"
    
    # Check if Groq key exists, if not use fallback to save costs/prevent errors
    groq_api_key = os.getenv("GROQ_API_KEY", "")
    
    if groq_api_key:
        logger.info("Groq API key found. Generating today's Executive Digest using Reporter LLM agent...")
        from agents.reporter.main import ReportGenerator
        
        generator = ReportGenerator(
            groq_api_key=groq_api_key,
            gemini_api_key=os.getenv("GEMINI_API_KEY", "")
        )
        try:
            digest = await generator.daily_digest(seeded_events)
            digest_data = digest.dict()
            await redis.setex(cache_key, 86400, json.dumps(digest_data, default=str))
            logger.info("Executive Digest successfully generated via LLM and cached in Redis.")
            return
        except Exception as e:
            logger.error(f"LLM Digest generation failed: {e}. Falling back to static cache seeding.")
            
    # Static Fallback Seeding (if no key, or LLM fails)
    logger.info("Seeding static fallback Executive Digest in Redis...")
    fallback_digest = {
        "summary": "Today's geopolitical intelligence digest reports heightened economic tensions in North America and Asia as new high-tariff policies on Chinese green technologies are enacted by the US. Concurrently, Russia and India continue bypass agreements for crude oil crude shipments via Northern Sea routes, while Sri Lanka and China establish structural debt updates concerning key logistics nodes.",
        "sections": [
            {
                "title": "Trade & Tariffs Escalations",
                "bullets": [
                    "The United States has enforced a 100% tariff on electric vehicles and a 50% tariff on solar cells originating from China to protect domestic manufacturing.",
                    "China and Sri Lanka finalised debt concessions regarding long-term logistics leases at Colombo Port's southern container terminal."
                ]
            },
            {
                "title": "Bilateral Energy Corridors",
                "bullets": [
                    "India and Russia signed a long-term strategic treaty expanding hydrocarbon shipping paths along the Northern Sea Route.",
                    "German authorities halted coal transit corridor pipelines temporarily to fulfill environmental target limits, causing local market supply strains."
                ]
            }
        ],
        "severity": 0.74,
        "sectors_affected": ["Energy", "Automotive", "Technology", "Logistics", "Agriculture"],
        "countries_affected": ["USA", "CHN", "IND", "RUS", "DEU", "LKA", "BRA"]
    }
    await redis.setex(cache_key, 86400, json.dumps(fallback_digest, default=str))
    logger.info("Static Executive Digest successfully cached in Redis.")


async def main():
    logger.info("=== Starting Sarwagya Database Seeding Script ===")
    try:
        seeded_events = await seed_neo4j()
        await seed_redis_digest(seeded_events)
        logger.info("=== Database Seeding Completed Successfully! ===")
    except Exception as e:
        logger.error(f"Seeding failed: {e}", exc_info=True)

if __name__ == "__main__":
    asyncio.run(main())

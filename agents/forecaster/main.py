"""
forecaster/main.py — Impact Forecasting Agent for Sarwagya
Given an event, predicts cascading impacts on countries using:
  1. Neo4j knowledge graph (dependency chains)
  2. Groq LLM chain-of-thought reasoning (free)
  3. Historical pattern matching from PostgreSQL

Example query:
  "China bans rare earth exports to USA"
  → Impact on: USA (critical), Japan (high), South Korea (high), EU (medium)
  → Sectors: semiconductors, defense, EVs
  → Timeline: 3-6 months for supply shock
"""
import logging
import json
import re
from datetime import datetime
from pydantic import BaseModel
from typing import Optional
from groq import Groq

logger = logging.getLogger(__name__)


# ── Output schemas ─────────────────────────────────────────────────────────

class CountryImpact(BaseModel):
    country_iso3: str
    country_name: str
    impact_level: str          # CRITICAL | HIGH | MEDIUM | LOW | MINIMAL
    impact_score: float        # 0.0 - 1.0
    impact_type: str           # ECONOMIC | POLITICAL | SECURITY | MIXED
    affected_sectors: list[str]
    mechanism: str             # How the impact propagates (1-2 sentences)
    timeline: str              # IMMEDIATE | WEEKS | MONTHS | YEARS
    beneficiary: bool          # Does this country actually benefit?


class ForecastResult(BaseModel):
    event_summary: str
    trigger_country: Optional[str]
    target_country: Optional[str]
    event_type: str
    severity: float
    global_impact_score: float   # 0.0 - 1.0
    country_impacts: list[CountryImpact]
    supply_chain_risks: list[str]
    commodity_effects: list[dict]   # [{commodity, direction, magnitude}]
    scenario_short: str    # 1-3 months outlook
    scenario_medium: str   # 3-12 months outlook
    scenario_long: str     # 1-3 years outlook
    confidence: float
    generated_at: str


# ── Dependency chain builder ───────────────────────────────────────────────

class DependencyAnalyzer:
    """
    Builds dependency chains from Neo4j graph.
    Maps how an event in Country A propagates to Country B, C, D...
    """
    def __init__(self, neo4j_driver):
        self.driver = neo4j_driver

    async def get_trade_dependents(self, iso3: str, commodity: str = None) -> list[dict]:
        """Find countries most dependent on imports from iso3."""
        query = """
        MATCH (source:Country {iso3: $iso3})-[r:TRADES_WITH]->(dependent:Country)
        WHERE r.exports_usd IS NOT NULL
        RETURN dependent.iso3 AS iso3,
               dependent.name AS name,
               r.exports_usd AS export_value,
               r.top_commodities AS commodities
        ORDER BY r.exports_usd DESC
        LIMIT 20
        """
        async with self.driver.session() as session:
            result = await session.run(query, iso3=iso3)
            return await result.data()

    async def get_supply_chain_exposure(self, commodity: str) -> list[dict]:
        """Find all countries dependent on a specific commodity."""
        query = """
        MATCH (a:Country)-[r:TRADES_WITH]->(b:Country)
        WHERE $commodity IN r.top_commodities
        RETURN a.iso3 AS importer, b.iso3 AS exporter,
               r.imports_usd AS value
        ORDER BY r.imports_usd DESC
        LIMIT 30
        """
        async with self.driver.session() as session:
            result = await session.run(query, commodity=commodity)
            return await result.data()

    async def get_alliance_network(self, iso3: str) -> list[dict]:
        """Get alliance partners who might be drawn into an event."""
        query = """
        MATCH (c:Country {iso3: $iso3})-[:ALLY_OF]->(ally:Country)
        RETURN ally.iso3 AS iso3, ally.name AS name
        """
        async with self.driver.session() as session:
            result = await session.run(query, iso3=iso3)
            return await result.data()


# ── Forecaster ────────────────────────────────────────────────────────────

class ImpactForecaster:
    def __init__(self, groq_api_key: str, neo4j_driver=None):
        self.groq = Groq(api_key=groq_api_key)
        self.neo4j = neo4j_driver
        self.dep_analyzer = DependencyAnalyzer(neo4j_driver) if neo4j_driver else None

    async def _get_graph_context(self, trigger_iso3: str, target_iso3: str = None) -> str:
        """Pull relevant graph data to ground the LLM's reasoning."""
        if not self.dep_analyzer:
            return "No graph context available."

        context_parts = []

        try:
            dependents = await self.dep_analyzer.get_trade_dependents(trigger_iso3)
            if dependents:
                context_parts.append(
                    f"Countries most dependent on {trigger_iso3} exports: "
                    + ", ".join(f"{d['iso3']} (${d['export_value']:,.0f})" for d in dependents[:5])
                )

            allies = await self.dep_analyzer.get_alliance_network(trigger_iso3)
            if allies:
                context_parts.append(
                    f"Alliance partners of {trigger_iso3}: "
                    + ", ".join(a["iso3"] for a in allies[:5])
                )
        except Exception as e:
            logger.warning(f"Graph context fetch failed: {e}")

        return "\n".join(context_parts) if context_parts else "Limited graph data available."

    def _llm_forecast(self, event_description: str, graph_context: str) -> dict:
        """
        Use Groq Llama3 for chain-of-thought impact forecasting.
        Grounds reasoning in graph context.
        """
        prompt = f"""You are a senior geopolitical analyst at a think tank. Analyze this event and forecast its cascading impacts in a comprehensive, thorough, and highly detailed intelligence forecast. Provide rich explanations, detailed mechanisms, and deep scenario analyses rather than brief summaries.

EVENT: {event_description}

KNOWN RELATIONSHIPS FROM KNOWLEDGE GRAPH:
{graph_context}

Think step by step:
1. Who are the direct actors?
2. What trade/investment/security dependencies exist?
3. Which countries are downstream in the supply chain?
4. What are the 2nd and 3rd order effects?

Return ONLY valid JSON:
{{
  "event_summary": "A detailed, comprehensive analysis of the geopolitical event, its historical context, and immediate significance (3-5 sentences).",
  "trigger_country": "ISO3 or null",
  "target_country": "ISO3 or null",
  "event_type": "TARIFF|SANCTION|CONFLICT|TREATY|EMBARGO|etc",
  "severity": <0.0-1.0>,
  "global_impact_score": <0.0-1.0>,
  "country_impacts": [
    {{
      "country_iso3": "ISO3",
      "country_name": "full name",
      "impact_level": "CRITICAL|HIGH|MEDIUM|LOW|MINIMAL",
      "impact_score": <0.0-1.0>,
      "impact_type": "ECONOMIC|POLITICAL|SECURITY|MIXED",
      "affected_sectors": ["sector1", "sector2"],
      "mechanism": "A thorough, step-by-step explanation of how the impact propagates to this country, describing specific trade links, alliance factors, or economic/security dependencies (4-6 sentences).",
      "timeline": "IMMEDIATE|WEEKS|MONTHS|YEARS",
      "beneficiary": <true if they gain from this>
    }}
  ],
  "supply_chain_risks": ["detailed risk description 1", "detailed risk description 2"],
  "commodity_effects": [
    {{"commodity": "name", "direction": "UP|DOWN|VOLATILE", "magnitude": "HIGH|MEDIUM|LOW"}}
  ],
  "scenario_short": "A detailed scenario analysis of the short-term outlook (1-3 months), describing the timeline of events, potential escalations, and strategic actions (4-6 sentences).",
  "scenario_medium": "A detailed scenario analysis of the medium-term outlook (3-12 months), describing the timeline of events, potential escalations, and strategic actions (4-6 sentences).",
  "scenario_long": "A detailed scenario analysis of the long-term outlook (1-3 years), describing the timeline of events, potential escalations, and strategic actions (4-6 sentences).",
  "confidence": <0.0-1.0>
}}"""

        try:
            response = self.groq.chat.completions.create(
                model="llama-3.3-70b-versatile",   # use 70B successor for forecasting accuracy
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=2000,
            )
            raw = response.choices[0].message.content.strip()
            raw = re.sub(r"```(?:json)?", "", raw).strip()
            return json.loads(raw)
        except Exception as e:
            logger.error(f"LLM forecast failed: {e}")
            return {
                "event_summary": event_description[:100],
                "trigger_country": None,
                "target_country": None,
                "event_type": "OTHER",
                "severity": 0.5,
                "global_impact_score": 0.3,
                "country_impacts": [],
                "supply_chain_risks": [],
                "commodity_effects": [],
                "scenario_short": "Analysis unavailable.",
                "scenario_medium": "Analysis unavailable.",
                "scenario_long": "Analysis unavailable.",
                "confidence": 0.2,
            }

    async def forecast(
        self,
        event_description: str,
        trigger_iso3: str = None,
        target_iso3: str = None,
    ) -> ForecastResult:
        """
        Main forecast entry point.
        event_description: plain English event, e.g.
          "China imposes 25% tariff on US semiconductor imports"
        """
        logger.info(f"Forecasting impact: {event_description[:80]}...")

        # Pull graph context to ground LLM reasoning
        graph_context = "No graph data."
        if trigger_iso3:
            graph_context = await self._get_graph_context(trigger_iso3, target_iso3)

        # LLM chain-of-thought forecast
        raw = self._llm_forecast(event_description, graph_context)

        country_impacts = []
        for ci in raw.get("country_impacts", []):
            try:
                country_impacts.append(CountryImpact(**ci))
            except Exception:
                pass

        return ForecastResult(
            **{k: v for k, v in raw.items() if k != "country_impacts"},
            country_impacts=country_impacts,
            generated_at=datetime.utcnow().isoformat(),
        )

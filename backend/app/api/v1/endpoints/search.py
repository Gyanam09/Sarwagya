"""
search.py — Natural Language Intelligence Search endpoint
Accepts free-form queries about country relations, economic sectors,
geopolitical events, and trade dependencies. Uses Groq/Gemini + the
existing Neo4j knowledge graph + seed events to synthesise a structured answer.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from app.core.security import check_rate_limit, TokenData
from app.core.database import get_neo4j_session, get_redis
from app.core.config import settings
import json
import hashlib
import logging
from datetime import datetime

router = APIRouter()
logger = logging.getLogger(__name__)

# ── Seed data pulled in when Neo4j is empty ───────────────────────────────

SEED_EVENTS = [
    {"title": "US Imposes New Tariffs on Chinese Electric Vehicles", "event_type": "TARIFF", "severity": 0.82, "summary": "Washington announced sweeping tariff hikes on Chinese EVs, solar panels, and semiconductors, escalating the ongoing trade war.", "countries_involved": ["USA", "CHN"], "affected_sectors": ["technology", "energy", "automotive"]},
    {"title": "Taiwan Strait Military Exercises Escalate Regional Tensions", "event_type": "MILITARY_ACTION", "severity": 0.78, "summary": "China conducted large-scale live-fire drills near Taiwan, prompting US carrier group deployment to the region.", "countries_involved": ["CHN", "TWN", "USA"], "affected_sectors": ["defense", "semiconductors", "shipping"]},
    {"title": "Russia-India Energy Agreement Expands Oil Corridor", "event_type": "TREATY", "severity": 0.65, "summary": "India and Russia signed a landmark energy cooperation pact expanding crude oil shipments via the Northern Sea Route.", "countries_involved": ["IND", "RUS"], "affected_sectors": ["energy", "trade"]},
    {"title": "OPEC+ Extends Production Cuts Through Q3", "event_type": "ECONOMIC_POLICY", "severity": 0.61, "summary": "OPEC+ agreed to maintain voluntary production cuts, sustaining elevated crude oil prices.", "countries_involved": ["SAU", "RUS", "ARE"], "affected_sectors": ["energy", "finance"]},
    {"title": "Germany Halts Coal Pipeline Operations", "event_type": "EMBARGO", "severity": 0.52, "summary": "Berlin suspended coal distribution corridors to meet EU emission targets.", "countries_involved": ["DEU"], "affected_sectors": ["energy", "agriculture"]},
    {"title": "Iran Nuclear Talks Stall Over Enrichment Limits", "event_type": "DIPLOMATIC", "severity": 0.71, "summary": "Negotiations between Iran and Western powers collapsed over uranium enrichment thresholds.", "countries_involved": ["IRN", "USA", "DEU", "FRA"], "affected_sectors": ["energy", "defense"]},
    {"title": "India-Pakistan Ceasefire Holds Along Line of Control", "event_type": "DIPLOMATIC", "severity": 0.55, "summary": "A renewed ceasefire agreement between India and Pakistan has held for 60 days, easing tensions in the Kashmir region.", "countries_involved": ["IND", "PAK"], "affected_sectors": ["defense", "trade"]},
    {"title": "South China Sea Territorial Dispute Intensifies", "event_type": "CONFLICT", "severity": 0.69, "summary": "Philippine and Chinese coast guard vessels clashed near disputed shoals, prompting US security guarantees.", "countries_involved": ["PHL", "CHN", "USA"], "affected_sectors": ["shipping", "defense", "energy"]},
]

COUNTRY_CONTEXT = {
    "USA": {"name": "United States", "gdp_usd_tn": 27.4, "key_sectors": ["technology", "defense", "finance", "agriculture"], "alliances": ["NATO", "QUAD", "G7"]},
    "CHN": {"name": "China", "gdp_usd_tn": 17.7, "key_sectors": ["manufacturing", "technology", "energy", "rare earths"], "alliances": ["SCO", "BRICS"]},
    "RUS": {"name": "Russia", "gdp_usd_tn": 2.2, "key_sectors": ["energy", "defense", "agriculture"], "alliances": ["CIS", "SCO", "BRICS"]},
    "IND": {"name": "India", "gdp_usd_tn": 3.7, "key_sectors": ["IT", "pharmaceuticals", "agriculture", "manufacturing"], "alliances": ["QUAD", "SCO", "BRICS"]},
    "SAU": {"name": "Saudi Arabia", "gdp_usd_tn": 1.1, "key_sectors": ["energy", "finance", "construction"], "alliances": ["OPEC+", "GCC", "Arab League"]},
    "DEU": {"name": "Germany", "gdp_usd_tn": 4.5, "key_sectors": ["automotive", "engineering", "chemicals", "finance"], "alliances": ["NATO", "EU", "G7"]},
    "JPN": {"name": "Japan", "gdp_usd_tn": 4.2, "key_sectors": ["automotive", "electronics", "robotics", "finance"], "alliances": ["QUAD", "G7"]},
    "GBR": {"name": "United Kingdom", "gdp_usd_tn": 3.1, "key_sectors": ["finance", "defense", "pharmaceuticals", "energy"], "alliances": ["NATO", "G7", "AUKUS"]},
    "FRA": {"name": "France", "gdp_usd_tn": 3.0, "key_sectors": ["aerospace", "luxury goods", "nuclear energy", "agriculture"], "alliances": ["NATO", "EU", "G7"]},
    "IRN": {"name": "Iran", "gdp_usd_tn": 0.7, "key_sectors": ["energy", "petrochemicals", "defense"], "alliances": ["SCO observer"]},
    "TWN": {"name": "Taiwan", "gdp_usd_tn": 0.8, "key_sectors": ["semiconductors", "electronics", "manufacturing"], "alliances": ["informal US partnership"]},
    "KOR": {"name": "South Korea", "gdp_usd_tn": 1.7, "key_sectors": ["semiconductors", "shipbuilding", "automotive", "electronics"], "alliances": ["US alliance"]},
    "BRA": {"name": "Brazil", "gdp_usd_tn": 2.1, "key_sectors": ["agriculture", "mining", "energy", "manufacturing"], "alliances": ["BRICS", "Mercosur"]},
    "AUS": {"name": "Australia", "gdp_usd_tn": 1.7, "key_sectors": ["mining", "agriculture", "energy", "finance"], "alliances": ["QUAD", "AUKUS", "Five Eyes"]},
    "PHL": {"name": "Philippines", "gdp_usd_tn": 0.4, "key_sectors": ["services", "electronics", "agriculture"], "alliances": ["US mutual defense treaty"]},
}


class IntelQueryRequest(BaseModel):
    query: str
    context_countries: Optional[List[str]] = None  # optional ISO3 list to focus on


class IntelQueryResponse(BaseModel):
    query: str
    answer: str
    key_points: List[str]
    relevant_events: List[Dict[str, Any]]
    countries_involved: List[str]
    sectors_affected: List[str]
    confidence: str
    sources: List[str]
    query_type: str
    generated_at: str


def build_context(query: str, events: List[Dict], focus_countries: Optional[List[str]] = None) -> str:
    """Build a rich context string from available data to ground the LLM."""
    # Filter events relevant to the query
    q_lower = query.lower()
    relevant_events = [
        e for e in events
        if any(
            kw in q_lower
            for kw in
            (e.get("countries_involved") or [])
            + (e.get("affected_sectors") or [])
            + [(e.get("event_type") or "").lower()]
        )
    ] or events[:5]  # fallback: top 5 by severity

    # Build country context for countries mentioned
    mentioned_countries = []
    if focus_countries:
        mentioned_countries = focus_countries
    else:
        for iso3 in COUNTRY_CONTEXT:
            name = COUNTRY_CONTEXT[iso3]["name"].lower()
            if name in q_lower or iso3.lower() in q_lower:
                mentioned_countries.append(iso3)

    country_ctx = ""
    for iso3 in mentioned_countries[:4]:
        if iso3 in COUNTRY_CONTEXT:
            c = COUNTRY_CONTEXT[iso3]
            country_ctx += f"\n- {c['name']} ({iso3}): GDP ${c['gdp_usd_tn']}T, Key sectors: {', '.join(c['key_sectors'])}, Alliances: {', '.join(c['alliances'])}"

    events_ctx = "\n".join([
        f"- [{e['event_type']}] {e['title']} (severity {e['severity']:.0%}): {e['summary']}"
        for e in relevant_events[:6]
    ])

    return f"""CURRENT GEOPOLITICAL EVENTS:
{events_ctx}

COUNTRY PROFILES:{country_ctx if country_ctx else " (general global context)"}

USER QUERY: {query}"""


async def call_groq_llm(prompt: str) -> str:
    """Call Groq LLM (llama3-70b) for fast inference."""
    try:
        from groq import AsyncGroq
        client = AsyncGroq(api_key=settings.GROQ_API_KEY)
        response = await client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are Sarwagya, an elite geospatial intelligence analyst. "
                        "You analyse country relationships, economic sectors, trade dependencies, "
                        "geopolitical events, and strategic risks with precision. "
                        "Always ground your answers in the provided event data and country profiles. "
                        "Be concise, analytical, and use specific data points. "
                        "Format your response as a JSON object with these exact keys: "
                        "answer (string, 2-3 paragraphs), "
                        "key_points (array of 3-5 short strings), "
                        "countries_involved (array of ISO3 codes), "
                        "sectors_affected (array of sector strings), "
                        "confidence (HIGH/MEDIUM/LOW), "
                        "query_type (COUNTRY_RELATIONS/ECONOMIC/MILITARY/TRADE/ENERGY/DIPLOMATIC/GENERAL)."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=1200,
            response_format={"type": "json_object"},
        )
        return response.choices[0].message.content or "{}"
    except Exception as e:
        logger.error(f"Groq call failed: {e}")
        raise


async def call_gemini_llm(prompt: str) -> str:
    """Fallback: Gemini Flash for the query."""
    try:
        import google.generativeai as genai
        genai.configure(api_key=settings.GEMINI_API_KEY)
        model = genai.GenerativeModel(
            "gemini-2.0-flash",
            generation_config={"response_mime_type": "application/json", "temperature": 0.3},
            system_instruction=(
                "You are Sarwagya, an elite geospatial intelligence analyst. "
                "Analyse country relationships, economic sectors, trade dependencies, "
                "geopolitical events, and strategic risks with precision. "
                "Respond ONLY with a JSON object: "
                "{answer: string, key_points: string[], countries_involved: string[], "
                "sectors_affected: string[], confidence: 'HIGH'|'MEDIUM'|'LOW', "
                "query_type: 'COUNTRY_RELATIONS'|'ECONOMIC'|'MILITARY'|'TRADE'|'ENERGY'|'DIPLOMATIC'|'GENERAL'}"
            ),
        )
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        logger.error(f"Gemini call failed: {e}")
        raise


@router.post("/intel", response_model=IntelQueryResponse)
async def intelligence_search(
    body: IntelQueryRequest,
    neo4j=Depends(get_neo4j_session),
    current_user: TokenData = Depends(check_rate_limit),
):
    """
    Natural language intelligence query endpoint.
    Accepts questions like:
     - "What is the relationship between India and Russia in the energy sector?"
     - "How do US tariffs on China affect the semiconductor supply chain?"
     - "Which countries are most exposed to the South China Sea conflict?"
    """
    if not body.query or len(body.query.strip()) < 5:
        raise HTTPException(400, "Query too short")
    if len(body.query) > 500:
        raise HTTPException(400, "Query too long (max 500 chars)")

    redis = get_redis()
    cache_key = "intel_search:" + hashlib.md5(
        f"{body.query.lower().strip()}{json.dumps(body.context_countries or [])}".encode()
    ).hexdigest()

    cached = await redis.get(cache_key)
    if cached:
        logger.info(f"Intel search cache hit for: {body.query[:60]}")
        return json.loads(cached)

    # ── Fetch live events from graph (fallback to seed) ────────────────────
    try:
        result = await neo4j.run("""
            MATCH (e:Event)
            WHERE e.date >= date() - duration({days: 60})
            OPTIONAL MATCH (c:Country)-[:INVOLVED_IN]->(e)
            RETURN e.title AS title, e.event_type AS event_type,
                   e.severity AS severity, e.summary AS summary,
                   collect(DISTINCT c.iso3) AS countries_involved,
                   e.affected_sectors AS affected_sectors
            ORDER BY e.severity DESC LIMIT 20
        """)
        events = await result.data()
        if not events:
            events = SEED_EVENTS
    except Exception as e:
        logger.warning(f"Neo4j fetch failed, using seed data: {e}")
        events = SEED_EVENTS

    # ── Build LLM prompt ───────────────────────────────────────────────────
    context = build_context(body.query, events, body.context_countries)

    # ── Call LLM (Groq primary, Gemini fallback) ───────────────────────────
    raw_json = None
    try:
        raw_json = await call_groq_llm(context)
    except Exception:
        logger.warning("Groq failed, trying Gemini fallback")
        try:
            raw_json = await call_gemini_llm(context)
        except Exception as e2:
            logger.error(f"Both LLMs failed: {e2}")
            raise HTTPException(503, "Intelligence analysis temporarily unavailable. Please try again.")

    # ── Parse LLM response ─────────────────────────────────────────────────
    try:
        parsed = json.loads(raw_json)
    except Exception:
        raise HTTPException(500, "Failed to parse intelligence analysis")

    # ── Find relevant seed events for response ─────────────────────────────
    involved_isos = parsed.get("countries_involved", [])
    relevant_events = [
        e for e in events
        if any(c in involved_isos for c in (e.get("countries_involved") or []))
    ][:4]

    response = {
        "query": body.query,
        "answer": parsed.get("answer", "Analysis unavailable."),
        "key_points": parsed.get("key_points", []),
        "relevant_events": relevant_events,
        "countries_involved": involved_isos,
        "sectors_affected": parsed.get("sectors_affected", []),
        "confidence": parsed.get("confidence", "MEDIUM"),
        "sources": ["Sarwagya Neo4j Knowledge Graph", "GDELT Events", "World Bank Data", "Groq LLaMA-3.3-70B"],
        "query_type": parsed.get("query_type", "GENERAL"),
        "generated_at": datetime.utcnow().isoformat(),
    }

    # Cache for 30 minutes
    await redis.setex(cache_key, 1800, json.dumps(response))
    return response

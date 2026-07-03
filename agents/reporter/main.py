"""
reporter/main.py — Intelligence Report Generator for Sarwagya
Generates structured intelligence briefs using:
  - Groq Llama3 70B (free) for analysis
  - Google Gemini Flash (free) as fallback
  - Data from Neo4j + PostgreSQL

Report types:
  - COUNTRY_BRIEF: Full country intelligence profile
  - EVENT_BRIEF: Analysis of a specific event
  - BILATERAL_BRIEF: Relationship between two countries
  - DAILY_DIGEST: Top events of the day
"""
import logging
import json
import re
from datetime import datetime
from pydantic import BaseModel
from typing import Optional
from groq import Groq
import google.generativeai as genai

logger = logging.getLogger(__name__)


# ── Report schemas ─────────────────────────────────────────────────────────

class ReportSection(BaseModel):
    heading: str
    content: str
    data_sources: list[str] = []


class IntelligenceReport(BaseModel):
    report_id: str
    report_type: str
    title: str
    classification: str = "UNCLASSIFIED"    # always unclassified (open source data)
    executive_summary: str
    sections: list[ReportSection]
    key_takeaways: list[str]
    risk_indicators: list[dict]   # [{indicator, level, trend}]
    data_sources_used: list[str]
    generated_at: str
    model_used: str
    confidence_note: str


# ── Report Generator ──────────────────────────────────────────────────────

class ReportGenerator:
    def __init__(self, groq_api_key: str, gemini_api_key: str = ""):
        self.groq = Groq(api_key=groq_api_key)
        if gemini_api_key:
            genai.configure(api_key=gemini_api_key)
            self.gemini = genai.GenerativeModel("gemini-1.5-flash")
        else:
            self.gemini = None

    def _call_groq(self, prompt: str, max_tokens: int = 2000) -> str:
        response = self.groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a senior intelligence analyst writing structured reports "
                        "based on open-source data. Be factual, precise, and analytical. "
                        "Never speculate beyond what the data supports. "
                        "Always note uncertainty and confidence levels."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content.strip()

    def _call_gemini(self, prompt: str) -> str:
        if not self.gemini:
            raise RuntimeError("Gemini not configured")
        response = self.gemini.generate_content(prompt)
        return response.text.strip()

    def _llm_call(self, prompt: str, max_tokens: int = 2000) -> str:
        """Try Groq first, fall back to Gemini."""
        try:
            return self._call_groq(prompt, max_tokens)
        except Exception as e:
            logger.warning(f"Groq failed, trying Gemini: {e}")
            if self.gemini:
                return self._call_gemini(prompt)
            raise

    def _parse_json_response(self, raw: str) -> dict:
        raw = re.sub(r"```(?:json)?", "", raw).strip()
        return json.loads(raw)

    # ── Report types ──────────────────────────────────────────────────────

    async def country_brief(
        self,
        country_iso3: str,
        country_name: str,
        indicators: dict,
        recent_events: list[dict],
        relationships: list[dict],
    ) -> IntelligenceReport:
        """Generate a comprehensive country intelligence brief."""

        prompt = f"""Generate a structured intelligence brief for {country_name} ({country_iso3}).

ECONOMIC INDICATORS:
{json.dumps(indicators, indent=2, default=str)[:1500]}

RECENT EVENTS (last 30 days):
{json.dumps(recent_events[:10], indent=2, default=str)[:1000]}

KEY RELATIONSHIPS:
{json.dumps(relationships[:10], indent=2, default=str)[:800]}

Return valid JSON:
{{
  "executive_summary": "2-3 paragraph executive summary",
  "sections": [
    {{"heading": "Political Situation", "content": "...", "data_sources": ["source1"]}},
    {{"heading": "Economic Overview", "content": "...", "data_sources": ["World Bank", "IMF"]}},
    {{"heading": "Key Relationships & Alliances", "content": "...", "data_sources": []}},
    {{"heading": "Risk Assessment", "content": "...", "data_sources": []}},
    {{"heading": "Outlook", "content": "...", "data_sources": []}}
  ],
  "key_takeaways": ["takeaway 1", "takeaway 2", "takeaway 3"],
  "risk_indicators": [
    {{"indicator": "name", "level": "HIGH|MEDIUM|LOW", "trend": "RISING|STABLE|FALLING"}}
  ]
}}"""

        import hashlib
        report_id = hashlib.md5(f"country_{country_iso3}_{datetime.utcnow().date()}".encode()).hexdigest()[:12]

        try:
            raw = self._llm_call(prompt, max_tokens=3000)
            data = self._parse_json_response(raw)
            model_used = "Groq Llama-3.3-70B"
        except Exception as e:
            logger.error(f"Report generation failed: {e}")
            data = {
                "executive_summary": f"Intelligence brief for {country_name} could not be generated.",
                "sections": [],
                "key_takeaways": [],
                "risk_indicators": [],
            }
            model_used = "fallback"

        return IntelligenceReport(
            report_id=report_id,
            report_type="COUNTRY_BRIEF",
            title=f"Intelligence Brief: {country_name}",
            executive_summary=data.get("executive_summary", ""),
            sections=[ReportSection(**s) for s in data.get("sections", []) if isinstance(s, dict)],
            key_takeaways=data.get("key_takeaways", []),
            risk_indicators=data.get("risk_indicators", []),
            data_sources_used=["World Bank", "GDELT", "UN Comtrade", "Wikidata", "REST Countries"],
            generated_at=datetime.utcnow().isoformat(),
            model_used=model_used,
            confidence_note="Based on open-source data. Verify with primary sources before action.",
        )

    async def event_brief(
        self,
        event: dict,
        forecast: dict,
        related_history: list[dict] = None,
    ) -> IntelligenceReport:
        """Generate an event analysis brief with impact forecast."""

        prompt = f"""Analyze this geopolitical event and write an intelligence brief.

EVENT:
{json.dumps(event, indent=2, default=str)[:1000]}

IMPACT FORECAST:
{json.dumps(forecast, indent=2, default=str)[:1500]}

HISTORICAL PRECEDENTS:
{json.dumps((related_history or [])[:5], indent=2, default=str)[:500]}

Return valid JSON:
{{
  "executive_summary": "2 paragraph summary of event and significance",
  "sections": [
    {{"heading": "Event Description", "content": "...", "data_sources": []}},
    {{"heading": "Immediate Impacts", "content": "...", "data_sources": []}},
    {{"heading": "Cascading Effects", "content": "...", "data_sources": []}},
    {{"heading": "Historical Precedents", "content": "...", "data_sources": []}},
    {{"heading": "Recommended Watch Points", "content": "...", "data_sources": []}}
  ],
  "key_takeaways": ["3-5 key takeaways"],
  "risk_indicators": [
    {{"indicator": "name", "level": "HIGH|MEDIUM|LOW", "trend": "RISING|STABLE|FALLING"}}
  ]
}}"""

        import hashlib
        event_id = event.get("event_id", "unknown")
        report_id = hashlib.md5(f"event_{event_id}".encode()).hexdigest()[:12]

        try:
            raw = self._llm_call(prompt, max_tokens=2500)
            data = self._parse_json_response(raw)
            model_used = "Groq Llama3-70B"
        except Exception as e:
            logger.error(f"Event brief failed: {e}")
            data = {"executive_summary": "", "sections": [], "key_takeaways": [], "risk_indicators": []}
            model_used = "fallback"

        return IntelligenceReport(
            report_id=report_id,
            report_type="EVENT_BRIEF",
            title=f"Event Analysis: {event.get('title', 'Geopolitical Event')[:80]}",
            executive_summary=data.get("executive_summary", ""),
            sections=[ReportSection(**s) for s in data.get("sections", []) if isinstance(s, dict)],
            key_takeaways=data.get("key_takeaways", []),
            risk_indicators=data.get("risk_indicators", []),
            data_sources_used=["GDELT", "NewsAPI", "Sarwagya Knowledge Graph"],
            generated_at=datetime.utcnow().isoformat(),
            model_used=model_used,
            confidence_note="AI-generated analysis. Cross-reference with primary sources.",
        )

    async def bilateral_brief(
        self,
        country_a_iso3: str,
        country_a_name: str,
        country_b_iso3: str,
        country_b_name: str,
        relationship_data: dict,
    ) -> IntelligenceReport:
        """Generate a bilateral relationship intelligence brief."""

        prompt = f"""Analyze the relationship between {country_a_name} and {country_b_name}.

RELATIONSHIP DATA:
{json.dumps(relationship_data, indent=2, default=str)[:2000]}

Return valid JSON:
{{
  "executive_summary": "Overview of the bilateral relationship",
  "sections": [
    {{"heading": "Trade & Economic Ties", "content": "...", "data_sources": ["UN Comtrade", "World Bank"]}},
    {{"heading": "Political & Diplomatic Relations", "content": "...", "data_sources": []}},
    {{"heading": "Security & Military Dimension", "content": "...", "data_sources": []}},
    {{"heading": "Areas of Tension", "content": "...", "data_sources": []}},
    {{"heading": "Areas of Cooperation", "content": "...", "data_sources": []}},
    {{"heading": "Outlook", "content": "...", "data_sources": []}}
  ],
  "key_takeaways": ["3-5 takeaways"],
  "risk_indicators": [
    {{"indicator": "name", "level": "HIGH|MEDIUM|LOW", "trend": "RISING|STABLE|FALLING"}}
  ]
}}"""

        import hashlib
        report_id = hashlib.md5(f"bilateral_{country_a_iso3}_{country_b_iso3}_{datetime.utcnow().date()}".encode()).hexdigest()[:12]

        try:
            raw = self._llm_call(prompt, max_tokens=2500)
            data = self._parse_json_response(raw)
            model_used = "Groq Llama-3.3-70B"
        except Exception as e:
            logger.error(f"Bilateral brief failed: {e}")
            data = {"executive_summary": "", "sections": [], "key_takeaways": [], "risk_indicators": []}
            model_used = "fallback"

        return IntelligenceReport(
            report_id=report_id,
            report_type="BILATERAL_BRIEF",
            title=f"Bilateral Brief: {country_a_name} — {country_b_name}",
            executive_summary=data.get("executive_summary", ""),
            sections=[ReportSection(**s) for s in data.get("sections", []) if isinstance(s, dict)],
            key_takeaways=data.get("key_takeaways", []),
            risk_indicators=data.get("risk_indicators", []),
            data_sources_used=["UN Comtrade", "World Bank", "GDELT", "Correlates of War", "Sarwagya Graph"],
            generated_at=datetime.utcnow().isoformat(),
            model_used=model_used,
            confidence_note="Based on open-source intelligence. Not for operational use without verification.",
        )

    async def daily_digest(self, top_events: list[dict]) -> IntelligenceReport:
        """Generate a daily digest of top geopolitical events."""

        prompt = f"""Write a daily geopolitical intelligence digest for {datetime.utcnow().strftime('%B %d, %Y')}.

TOP EVENTS TODAY:
{json.dumps(top_events[:15], indent=2, default=str)[:2500]}

Return valid JSON:
{{
  "executive_summary": "2-paragraph overview of today's geopolitical landscape",
  "sections": [
    {{"heading": "Top Story", "content": "...", "data_sources": []}},
    {{"heading": "Economic & Trade", "content": "...", "data_sources": []}},
    {{"heading": "Security & Conflict", "content": "...", "data_sources": []}},
    {{"heading": "Diplomacy", "content": "...", "data_sources": []}},
    {{"heading": "Watch List", "content": "situations to monitor in next 48h", "data_sources": []}}
  ],
  "key_takeaways": ["5 key takeaways from today"],
  "risk_indicators": [
    {{"indicator": "name", "level": "HIGH|MEDIUM|LOW", "trend": "RISING|STABLE|FALLING"}}
  ]
}}"""

        import hashlib
        report_id = hashlib.md5(f"digest_{datetime.utcnow().date()}".encode()).hexdigest()[:12]

        try:
            raw = self._llm_call(prompt, max_tokens=2500)
            data = self._parse_json_response(raw)
            model_used = "Groq Llama-3.3-70B"
        except Exception as e:
            logger.error(f"Daily digest failed: {e}")
            data = {"executive_summary": "", "sections": [], "key_takeaways": [], "risk_indicators": []}
            model_used = "fallback"

        return IntelligenceReport(
            report_id=report_id,
            report_type="DAILY_DIGEST",
            title=f"Sarwagya Daily Intelligence Digest — {datetime.utcnow().strftime('%d %b %Y')}",
            executive_summary=data.get("executive_summary", ""),
            sections=[ReportSection(**s) for s in data.get("sections", []) if isinstance(s, dict)],
            key_takeaways=data.get("key_takeaways", []),
            risk_indicators=data.get("risk_indicators", []),
            data_sources_used=["GDELT", "NewsAPI", "World Bank", "Sarwagya Knowledge Graph"],
            generated_at=datetime.utcnow().isoformat(),
            model_used=model_used,
            confidence_note="AI-generated digest from open-source data. Updated daily.",
        )

"""
classifier/main.py — Event Classifier Agent for Sarwagya
Classifies extracted events into structured tags using Groq (free).
Outputs: event_type, severity, urgency, sectors, affected_countries
"""
import re
import json
import logging
from datetime import datetime
from pydantic import BaseModel
from groq import Groq

logger = logging.getLogger(__name__)

# ── Taxonomy ──────────────────────────────────────────────────────────────

EVENT_TAXONOMY = {
    "ECONOMIC": ["TARIFF", "TRADE_AGREEMENT", "EMBARGO", "ECONOMIC_POLICY", "INVESTMENT", "DEBT"],
    "DIPLOMATIC": ["TREATY", "DIPLOMATIC_MEETING", "EXPULSION", "RECOGNITION", "SUMMIT"],
    "SECURITY": ["MILITARY_ACTION", "CONFLICT", "CYBER_ATTACK", "ARMS_SALE", "ALLIANCE"],
    "POLITICAL": ["ELECTION", "COUP", "SANCTION", "PROTEST", "REGIME_CHANGE"],
    "HUMANITARIAN": ["AID", "REFUGEE", "FAMINE", "DISASTER", "HEALTH_CRISIS"],
    "ENERGY": ["OIL", "GAS", "RENEWABLE", "PIPELINE", "ENERGY_POLICY"],
}

SEVERITY_SCALE = {
    # 0.0 - 0.2: routine / low significance
    # 0.2 - 0.5: moderate, watch
    # 0.5 - 0.8: significant, affects markets/relations
    # 0.8 - 1.0: crisis level, immediate geopolitical impact
}

SECTORS = [
    "energy", "technology", "agriculture", "defense", "finance",
    "pharmaceuticals", "semiconductors", "rare_earths", "shipping",
    "food", "automotive", "telecommunications", "tourism",
]


# ── Output schemas ─────────────────────────────────────────────────────────

class ClassificationResult(BaseModel):
    event_category: str          # ECONOMIC | DIPLOMATIC | SECURITY | POLITICAL | etc.
    event_type: str              # specific sub-type
    severity: float              # 0.0 - 1.0
    urgency: str                 # IMMEDIATE | 24H | WEEK | MONTH
    affected_sectors: list[str]
    market_impact: str           # HIGH | MEDIUM | LOW | NONE
    stability_impact: str        # DESTABILIZING | NEUTRAL | STABILIZING
    confidence: float            # model confidence
    tags: list[str]              # free-form tags for search


# ── Classifier ────────────────────────────────────────────────────────────

class EventClassifier:
    def __init__(self, groq_api_key: str):
        self.groq = Groq(api_key=groq_api_key)

    def _rule_based_classify(self, text: str) -> dict:
        """
        Fast rule-based pre-classification before LLM.
        Catches obvious cases cheaply (no API call).
        """
        text_lower = text.lower()
        result = {"event_category": "OTHER", "event_type": "OTHER", "severity": 0.2}

        # Severity boosters
        high_severity_words = [
            "invasion", "war", "nuclear", "crisis", "collapse", "coup",
            "sanctions", "blockade", "attack", "explosion", "conflict",
        ]
        medium_severity_words = [
            "tariff", "treaty", "agreement", "summit", "election",
            "protest", "embargo", "alliance", "trade", "sanction",
        ]

        severity = 0.15
        for word in high_severity_words:
            if word in text_lower:
                severity = max(severity, 0.75)
                break
        for word in medium_severity_words:
            if word in text_lower:
                severity = max(severity, 0.4)
                break
        result["severity"] = severity

        # Category detection
        if any(w in text_lower for w in ["tariff", "trade", "export", "import", "gdp", "investment"]):
            result["event_category"] = "ECONOMIC"
        elif any(w in text_lower for w in ["war", "military", "troops", "missile", "attack", "cyber"]):
            result["event_category"] = "SECURITY"
        elif any(w in text_lower for w in ["summit", "treaty", "diplomat", "ambassador", "agreement"]):
            result["event_category"] = "DIPLOMATIC"
        elif any(w in text_lower for w in ["election", "president", "parliament", "protest", "coup"]):
            result["event_category"] = "POLITICAL"
        elif any(w in text_lower for w in ["oil", "gas", "energy", "pipeline", "renewable"]):
            result["event_category"] = "ENERGY"

        # Sector detection
        sectors = []
        sector_keywords = {
            "energy": ["oil", "gas", "energy", "pipeline", "petroleum"],
            "technology": ["tech", "semiconductor", "chip", "ai", "cyber", "software"],
            "defense": ["military", "weapon", "arms", "defense", "troops"],
            "finance": ["bank", "currency", "debt", "bond", "imf", "world bank"],
            "agriculture": ["food", "grain", "wheat", "agriculture", "famine"],
            "semiconductors": ["chip", "semiconductor", "tsmc", "nvidia", "intel"],
            "shipping": ["port", "shipping", "vessel", "maritime", "suez"],
        }
        for sector, keywords in sector_keywords.items():
            if any(kw in text_lower for kw in keywords):
                sectors.append(sector)
        result["affected_sectors"] = sectors[:5]

        return result

    def _llm_classify(self, text: str, title: str, pre_class: dict) -> ClassificationResult:
        """
        Deep classification using Groq Llama3 (free).
        Uses pre-classification to save tokens.
        """
        prompt = f"""Classify this geopolitical news event. Pre-analysis suggests category: {pre_class.get('event_category')}, severity: {pre_class.get('severity')}.

Title: {title}
Text: {text[:1500]}

Return ONLY valid JSON:
{{
  "event_category": "ECONOMIC|DIPLOMATIC|SECURITY|POLITICAL|HUMANITARIAN|ENERGY",
  "event_type": "specific type like TARIFF|TREATY|MILITARY_ACTION|SANCTION|ELECTION",
  "severity": <0.0-1.0>,
  "urgency": "IMMEDIATE|24H|WEEK|MONTH",
  "affected_sectors": ["max 4 sectors from: energy,technology,agriculture,defense,finance,semiconductors,shipping,food"],
  "market_impact": "HIGH|MEDIUM|LOW|NONE",
  "stability_impact": "DESTABILIZING|NEUTRAL|STABILIZING",
  "confidence": <0.0-1.0>,
  "tags": ["3-5 specific tags like 'US-China', 'rare-earths', 'trade-war']"
}}"""

        try:
            response = self.groq.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=400,
            )
            raw = response.choices[0].message.content.strip()
            raw = re.sub(r"```(?:json)?", "", raw).strip()
            data = json.loads(raw)
            return ClassificationResult(**data)
        except Exception as e:
            logger.warning(f"LLM classification failed, using rule-based: {e}")
            return ClassificationResult(
                event_category=pre_class.get("event_category", "OTHER"),
                event_type=pre_class.get("event_type", "OTHER"),
                severity=pre_class.get("severity", 0.2),
                urgency="WEEK",
                affected_sectors=pre_class.get("affected_sectors", []),
                market_impact="LOW",
                stability_impact="NEUTRAL",
                confidence=0.4,
                tags=[],
            )

    def classify(self, text: str, title: str = "") -> ClassificationResult:
        """
        Two-stage classification:
        1. Fast rule-based (always runs, free)
        2. LLM refinement (runs for severity > 0.3 to save API quota)
        """
        pre = self._rule_based_classify(f"{title} {text}")

        # Only use LLM for potentially significant events
        if pre["severity"] >= 0.3:
            return self._llm_classify(text, title, pre)

        # Low-significance events: use rule-based only
        return ClassificationResult(
            event_category=pre["event_category"],
            event_type=pre["event_type"],
            severity=pre["severity"],
            urgency="MONTH",
            affected_sectors=pre["affected_sectors"],
            market_impact="NONE",
            stability_impact="NEUTRAL",
            confidence=0.6,
            tags=[],
        )

    def classify_batch(self, articles: list[dict]) -> list[dict]:
        """Classify a batch of articles, attaching classification to each."""
        results = []
        for article in articles:
            title = article.get("title", "")
            text = article.get("description") or article.get("content") or ""
            classification = self.classify(text=text, title=title)
            results.append({
                **article,
                "classification": classification.dict(),
                "classified_at": datetime.utcnow().isoformat(),
            })
        logger.info(f"Classified {len(results)} articles")
        return results

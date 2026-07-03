"""
extractor/main.py — Entity Extraction Agent for Sarwagya
Extracts: Countries, Organizations, Events, Commodities, People
Uses: spaCy (free local NER) + Groq Llama3 for relation extraction (free API)
"""
import re
import json
import logging
from typing import Optional
from pydantic import BaseModel
from groq import Groq

logger = logging.getLogger(__name__)


# ── Output schemas ────────────────────────────────────────────────────────

class ExtractedEntity(BaseModel):
    text: str
    type: str        # COUNTRY | ORG | PERSON | COMMODITY | LOCATION | EVENT
    iso3: Optional[str] = None   # resolved ISO3 for countries


class ExtractedRelation(BaseModel):
    subject: str
    subject_type: str
    predicate: str   # IMPOSES_TARIFF | SIGNS_TREATY | INVADES | SANCTIONS | etc.
    object: str
    object_type: str
    sentiment: float  # -1.0 (hostile) to 1.0 (cooperative)
    confidence: float


class ExtractionResult(BaseModel):
    entities: list[ExtractedEntity]
    relations: list[ExtractedRelation]
    event_type: str
    severity: float    # 0.0 to 1.0
    affected_sectors: list[str]
    summary: str


# ── Country name → ISO3 map (abridged — extend as needed) ─────────────────

COUNTRY_ISO3 = {
    "united states": "USA", "america": "USA", "us": "USA", "u.s.": "USA",
    "china": "CHN", "china's": "CHN", "beijing": "CHN",
    "india": "IND", "new delhi": "IND",
    "russia": "RUS", "moscow": "RUS",
    "germany": "DEU", "berlin": "DEU",
    "france": "FRA", "paris": "FRA",
    "uk": "GBR", "united kingdom": "GBR", "britain": "GBR", "london": "GBR",
    "japan": "JPN", "tokyo": "JPN",
    "south korea": "KOR", "korea": "KOR",
    "saudi arabia": "SAU", "riyadh": "SAU",
    "iran": "IRN", "tehran": "IRN",
    "ukraine": "UKR", "kyiv": "UKR",
    "taiwan": "TWN", "taipei": "TWN",
    "israel": "ISR", "tel aviv": "ISR",
    "pakistan": "PAK", "islamabad": "PAK",
    "brazil": "BRA", "brasilia": "BRA",
    "australia": "AUS", "canberra": "AUS",
    "canada": "CAN", "ottawa": "CAN",
    "turkey": "TUR", "ankara": "TUR",
    "indonesia": "IDN", "jakarta": "IDN",
    "uae": "ARE", "dubai": "ARE",
    "egypt": "EGY", "cairo": "EGY",
}

EVENT_TYPES = [
    "TARIFF", "SANCTION", "TREATY", "MILITARY_ACTION", "DIPLOMATIC_MEETING",
    "TRADE_AGREEMENT", "INVESTMENT", "AID", "ELECTION", "PROTEST",
    "CYBER_ATTACK", "ECONOMIC_POLICY", "EMBARGO", "ALLIANCE", "CONFLICT",
    "HUMANITARIAN", "ENERGY", "TECHNOLOGY", "OTHER",
]

SECTORS = [
    "energy", "technology", "agriculture", "defense", "finance",
    "pharmaceuticals", "semiconductors", "rare_earths", "shipping",
    "food", "automotive", "telecommunications",
]


# ── Extractor ─────────────────────────────────────────────────────────────

class EntityExtractor:
    def __init__(self, groq_api_key: str):
        self.groq = Groq(api_key=groq_api_key)
        self._nlp = None   # lazy-load spaCy

    @property
    def nlp(self):
        if self._nlp is None:
            import spacy
            try:
                self._nlp = spacy.load("en_core_web_sm")
            except OSError:
                logger.warning("spaCy model not found. Run: python -m spacy download en_core_web_sm")
                self._nlp = None
        return self._nlp

    def _resolve_country(self, text: str) -> Optional[str]:
        return COUNTRY_ISO3.get(text.lower().strip())

    def _spacy_entities(self, text: str) -> list[ExtractedEntity]:
        """Fast local NER using spaCy (no API cost)."""
        if not self.nlp:
            return []
        doc = self.nlp(text)
        entities = []
        seen = set()
        for ent in doc.ents:
            key = (ent.text.lower(), ent.label_)
            if key in seen:
                continue
            seen.add(key)
            etype = {
                "GPE": "COUNTRY", "LOC": "LOCATION",
                "ORG": "ORG", "PERSON": "PERSON",
                "PRODUCT": "COMMODITY",
            }.get(ent.label_, "OTHER")
            iso3 = self._resolve_country(ent.text) if etype == "COUNTRY" else None
            entities.append(ExtractedEntity(text=ent.text, type=etype, iso3=iso3))
        return entities

    def _groq_extract(self, text: str, title: str = "") -> dict:
        """
        Use Groq (Llama 3 — free) for deep relation extraction.
        Returns structured JSON.
        """
        prompt = f"""You are a geopolitical intelligence analyst. Analyze this news article and extract structured information.

Title: {title}
Text: {text[:2000]}

Return ONLY valid JSON with this exact structure:
{{
  "relations": [
    {{
      "subject": "country or actor name",
      "subject_type": "COUNTRY|ORG|PERSON",
      "predicate": "one of: {', '.join(EVENT_TYPES[:10])}",
      "object": "country or actor name",
      "object_type": "COUNTRY|ORG|PERSON",
      "sentiment": <float -1.0 to 1.0>,
      "confidence": <float 0.0 to 1.0>
    }}
  ],
  "event_type": "one of: {', '.join(EVENT_TYPES)}",
  "severity": <float 0.0 to 1.0>,
  "affected_sectors": ["list of sectors from: {', '.join(SECTORS)}"],
  "summary": "one sentence summary of geopolitical significance"
}}"""

        try:
            response = self.groq.chat.completions.create(
                model="llama-3.1-8b-instant",   # free, fast
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=800,
            )
            raw = response.choices[0].message.content.strip()
            # Strip markdown fences if present
            raw = re.sub(r"```(?:json)?", "", raw).strip()
            return json.loads(raw)
        except json.JSONDecodeError as e:
            logger.warning(f"Groq JSON parse error: {e}")
            return {"relations": [], "event_type": "OTHER", "severity": 0.1,
                    "affected_sectors": [], "summary": ""}
        except Exception as e:
            logger.error(f"Groq API error: {e}")
            return {"relations": [], "event_type": "OTHER", "severity": 0.1,
                    "affected_sectors": [], "summary": ""}

    async def extract(self, text: str, title: str = "") -> ExtractionResult:
        """
        Full extraction pipeline:
        1. spaCy for fast local NER (free, no API)
        2. Groq for relation extraction (free API)
        """
        # Step 1: Local NER
        entities = self._spacy_entities(f"{title} {text}")

        # Step 2: LLM relation extraction
        groq_data = self._groq_extract(text, title)

        # Merge entities from Groq relations
        for rel in groq_data.get("relations", []):
            for field in ["subject", "object"]:
                name = rel.get(field, "")
                if name and not any(e.text.lower() == name.lower() for e in entities):
                    iso3 = self._resolve_country(name)
                    entities.append(ExtractedEntity(
                        text=name,
                        type=rel.get(f"{field}_type", "ORG"),
                        iso3=iso3,
                    ))

        relations = [
            ExtractedRelation(**r)
            for r in groq_data.get("relations", [])
            if all(k in r for k in ["subject", "predicate", "object"])
        ]

        return ExtractionResult(
            entities=entities,
            relations=relations,
            event_type=groq_data.get("event_type", "OTHER"),
            severity=groq_data.get("severity", 0.1),
            affected_sectors=groq_data.get("affected_sectors", []),
            summary=groq_data.get("summary", ""),
        )


# ── Batch processor ───────────────────────────────────────────────────────

class BatchExtractor:
    def __init__(self, groq_api_key: str):
        self.extractor = EntityExtractor(groq_api_key)

    async def process_articles(self, articles: list[dict]) -> list[dict]:
        """Process a batch of news articles."""
        results = []
        for article in articles:
            title = article.get("title", "")
            text = article.get("description") or article.get("content") or ""
            if not text:
                continue
            try:
                result = await self.extractor.extract(text=text, title=title)
                results.append({
                    "source_url": article.get("url", ""),
                    "title": title,
                    "published_at": article.get("publishedAt") or article.get("url", ""),
                    "extraction": result.dict(),
                })
            except Exception as e:
                logger.error(f"Extraction failed for article '{title[:50]}': {e}")
        logger.info(f"Extracted from {len(results)}/{len(articles)} articles")
        return results

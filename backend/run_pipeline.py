"""
run_pipeline.py - Standalone Sarwagya pipeline (no Airflow/Docker required)
Runs: GDELT + free RSS feeds -> EventClassifier -> local JSON cache + Neo4j (if online)

Usage (from backend/ with venv active):
    python run_pipeline.py              # Run once and exit
    python run_pipeline.py --loop 15   # Loop every 15 minutes
"""
import asyncio
import hashlib
import json
import logging
import sys
import os
import argparse
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv
load_dotenv(dotenv_path=ROOT / "backend" / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("pipeline")

# Local cache path - must match events.py _CACHE_PATH
CACHE_PATH = Path(__file__).resolve().parent / "app" / "data" / "events_cache.json"
CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)

COUNTRY_TO_ISO3 = {
    "united states": "USA", "us ": "USA", "u.s.": "USA", "usa": "USA",
    "america": "USA", "washington": "USA", "american": "USA",
    "china": "CHN", "chinese": "CHN", "beijing": "CHN",
    "russia": "RUS", "russian": "RUS", "moscow": "RUS",
    "india": "IND", "indian": "IND", "new delhi": "IND",
    "germany": "DEU", "german": "DEU", "berlin": "DEU",
    "france": "FRA", "french": "FRA", "paris": "FRA",
    "britain": "GBR", "united kingdom": "GBR", "british": "GBR", "london": "GBR", " uk ": "GBR",
    "japan": "JPN", "japanese": "JPN", "tokyo": "JPN",
    "south korea": "KOR", "seoul": "KOR",
    "north korea": "PRK", "pyongyang": "PRK",
    "iran": "IRN", "iranian": "IRN", "tehran": "IRN",
    "israel": "ISR", "israeli": "ISR", "tel aviv": "ISR", "gaza": "ISR",
    "saudi arabia": "SAU", "saudi": "SAU", "riyadh": "SAU",
    "ukraine": "UKR", "ukrainian": "UKR", "kyiv": "UKR", "kiev": "UKR",
    "taiwan": "TWN", "taiwanese": "TWN", "taipei": "TWN",
    "pakistan": "PAK", "pakistani": "PAK", "islamabad": "PAK",
    "turkey": "TUR", "turkish": "TUR", "ankara": "TUR", "erdogan": "TUR",
    "brazil": "BRA", "brazilian": "BRA",
    "australia": "AUS", "australian": "AUS", "canberra": "AUS",
    "canada": "CAN", "canadian": "CAN", "ottawa": "CAN",
    "mexico": "MEX", "mexican": "MEX",
    "indonesia": "IDN", "indonesian": "IDN",
    "philippines": "PHL", "filipino": "PHL", "manila": "PHL",
    "vietnam": "VNM", "vietnamese": "VNM", "hanoi": "VNM",
    "egypt": "EGY", "egyptian": "EGY", "cairo": "EGY",
    "nigeria": "NGA", "nigerian": "NGA",
    "south africa": "ZAF",
    "ethiopia": "ETH", "ethiopian": "ETH",
    "afghanistan": "AFG", "afghan": "AFG", "kabul": "AFG", "taliban": "AFG",
    "iraq": "IRQ", "iraqi": "IRQ", "baghdad": "IRQ",
    "syria": "SYR", "syrian": "SYR", "damascus": "SYR",
    "lebanon": "LBN", "lebanese": "LBN", "beirut": "LBN", "hezbollah": "LBN",
    "yemen": "YEM", "yemeni": "YEM", "houthi": "YEM",
    "libya": "LBY", "libyan": "LBY",
    "sudan": "SDN", "sudanese": "SDN",
    "myanmar": "MMR", "burmese": "MMR",
    "venezuela": "VEN", "venezuelan": "VEN",
    "colombia": "COL", "colombian": "COL",
    "poland": "POL", "polish": "POL", "warsaw": "POL",
    "italy": "ITA", "italian": "ITA",
    "spain": "ESP", "spanish": "ESP",
    "thailand": "THA", "thai": "THA",
    "malaysia": "MYS", "malaysian": "MYS",
    "qatar": "QAT", "doha": "QAT",
    "uae": "ARE", "emirates": "ARE", "dubai": "ARE",
    "kuwait": "KWT",
    "jordan": "JOR", "amman": "JOR",
    "armenia": "ARM",
    "azerbaijan": "AZE",
    "somalia": "SOM",
    "kenya": "KEN", "nairobi": "KEN",
    "chile": "CHL",
    "argentina": "ARG",
    "peru": "PER",
}

RSS_FEEDS = [
    ("Reuters World",  "https://feeds.reuters.com/reuters/worldNews"),
    ("Reuters Top",    "https://feeds.reuters.com/reuters/topNews"),
    ("BBC World",      "https://feeds.bbci.co.uk/news/world/rss.xml"),
    ("Al Jazeera",     "https://www.aljazeera.com/xml/rss/all.xml"),
    ("The Guardian",   "https://www.theguardian.com/world/rss"),
    ("Deutsche Welle", "https://rss.dw.com/xml/rss-en-world"),
]

GEOPOLITICAL_KEYWORDS = {
    "war", "conflict", "military", "sanction", "diplomacy", "treaty",
    "nuclear", "missile", "tariff", "embargo", "invasion", "troops",
    "summit", "agreement", "alliance", "protest", "coup", "election",
    "trade", "export", "import", "oil", "energy", "crisis", "attack",
    "ceasefire", "negotiation", "parliament", "president", "minister",
    "airstrike", "drone", "blockade", "hostage", "refugee",
}


def extract_countries(text: str) -> list:
    text_lower = " " + text.lower() + " "
    found = {}
    for name, iso3 in COUNTRY_TO_ISO3.items():
        if name in text_lower:
            found[iso3] = True
    return list(found.keys())[:5]


def is_geopolitical(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in GEOPOLITICAL_KEYWORDS)


async def fetch_rss(name: str, url: str, client) -> list:
    try:
        r = await client.get(url, timeout=15)
        r.raise_for_status()
        root = ET.fromstring(r.content)
        articles = []
        for item in root.findall(".//item"):
            title = (item.findtext("title") or "").strip()
            desc  = (item.findtext("description") or "").strip()
            link  = (item.findtext("link") or "").strip()
            pub   = (item.findtext("pubDate") or datetime.now().strftime("%Y-%m-%d"))
            if title and is_geopolitical(f"{title} {desc}"):
                articles.append({"title": title, "description": desc,
                                  "url": link, "publishedAt": pub, "source": name})
        logger.info(f"  {name}: {len(articles)} geopolitical articles")
        return articles
    except Exception as e:
        logger.warning(f"  {name} RSS failed: {e}")
        return []


async def fetch_gdelt(client) -> list:
    url = "https://api.gdeltproject.org/api/v2/doc/doc"
    for query in ["sanctions diplomacy", "military war", "trade conflict"]:
        try:
            await asyncio.sleep(2)  # be gentle before each attempt
            r = await client.get(url, params={
                "query": query, "mode": "ArtList",
                "maxrecords": 100, "timespan": "24h", "format": "json",
            }, timeout=30)
            if r.status_code == 429:
                logger.warning(f"  GDELT 429 ('{query}') — skipping to RSS")
                continue
            r.raise_for_status()
            articles = r.json().get("articles", [])
            logger.info(f"  GDELT: {len(articles)} articles")
            return articles
        except Exception as e:
            logger.warning(f"  GDELT failed: {e}")
    return []


def load_existing_cache() -> dict:
    """Load existing cache as a dict keyed by event_id to avoid duplicates."""
    if CACHE_PATH.exists():
        try:
            with open(CACHE_PATH, "r", encoding="utf-8") as f:
                events = json.load(f)
                return {e["event_id"]: e for e in events if "event_id" in e}
        except Exception:
            pass
    return {}


def save_cache(events: list):
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(events, f, indent=2, ensure_ascii=False, default=str)
    logger.info(f"  Cache saved: {len(events)} total events -> {CACHE_PATH}")


async def write_to_neo4j(classified: list) -> int:
    """Attempt to write events to Neo4j. Returns count written (0 if offline)."""
    from agents.graph_updater.main import GraphUpdater
    neo4j_uri  = os.getenv("NEO4J_URI", "")
    neo4j_user = os.getenv("NEO4J_USER", "neo4j")
    neo4j_pass = os.getenv("NEO4J_PASSWORD", "")
    if not neo4j_uri or not neo4j_pass:
        return 0

    import socket
    try:
        host = neo4j_uri.split("//")[-1].split(":")[0].split("/")[0]
        socket.gethostbyname(host)
    except Exception:
        logger.warning(f"  Neo4j offline ({host}) — skipping graph write. Resume at console.neo4j.io")
        return 0

    updater = GraphUpdater(neo4j_uri=neo4j_uri, neo4j_user=neo4j_user, neo4j_password=neo4j_pass)
    written = 0
    try:
        await updater.init_schema()
        for item in classified:
            for iso3 in item["countries"]:
                try:
                    async with updater.driver.session() as s:
                        await s.run(
                            "MERGE (c:Country {iso3: $iso3}) ON CREATE SET c.name = $iso3, c.updated_at = datetime()",
                            iso3=iso3,
                        )
                except Exception:
                    pass
            extraction = {
                "event_type": item["event_type"],
                "severity": item["severity"],
                "affected_sectors": item["affected_sectors"],
                "summary": item["summary"],
                "entities": [{"type": "COUNTRY", "iso3": iso3} for iso3 in item["countries"]],
                "relations": [],
            }
            try:
                await updater.process_extraction_result(extraction, {"title": item["title"], "source_url": item["url"]})
                written += 1
            except Exception as e:
                logger.debug(f"  Neo4j write error: {e}")
    finally:
        await updater.close()
    return written


async def run_once():
    import httpx
    start = time.time()
    logger.info("=" * 60)
    logger.info(f"  Sarwagya Pipeline - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info("=" * 60)

    # ── Step 1: Collect ────────────────────────────────────────────────
    logger.info("Step 1/3 - Collecting news...")
    articles = []

    async with httpx.AsyncClient(
        headers={"User-Agent": "Sarwagya/0.1 geopolitical-intelligence"},
        follow_redirects=True,
    ) as client:
        gdelt = await fetch_gdelt(client)
        articles.extend(gdelt)

        rss_results = await asyncio.gather(
            *[fetch_rss(name, url, client) for name, url in RSS_FEEDS],
            return_exceptions=True,
        )
        for r in rss_results:
            if isinstance(r, list):
                articles.extend(r)

        # NewsAPI (optional)
        key = os.getenv("NEWS_API_KEY", "")
        if key:
            try:
                r = await client.get("https://newsapi.org/v2/everything",
                    params={"q": "war sanctions diplomacy", "language": "en",
                             "pageSize": 50, "apiKey": key, "sortBy": "publishedAt"}, timeout=15)
                if r.status_code == 200:
                    na = r.json().get("articles", [])
                    articles.extend(na)
                    logger.info(f"  NewsAPI: {len(na)} articles")
                else:
                    logger.warning(f"  NewsAPI {r.status_code} - key may need renewal at newsapi.org")
            except Exception as e:
                logger.warning(f"  NewsAPI: {e}")

    if not articles:
        logger.error("No articles collected.")
        return 0

    logger.info(f"  Total collected: {len(articles)} articles")

    # ── Step 2: Classify ───────────────────────────────────────────────
    logger.info("Step 2/3 - Classifying...")
    from agents.classifier.main import EventClassifier

    groq_key = os.getenv("GROQ_API_KEY", "dummy")  # rule-based does not need it
    classifier = EventClassifier(groq_api_key=groq_key)
    classified = []
    llm_count = 0

    for art in articles:
        title   = (art.get("title") or "").strip()
        desc    = (art.get("description") or art.get("content") or "").strip()
        url     = art.get("url") or art.get("sourceurl") or ""
        date_s  = (art.get("publishedAt") or datetime.now().strftime("%Y-%m-%d"))[:10]

        if not title or len(title) < 10:
            continue

        countries = extract_countries(f"{title} {desc}")
        if not countries:
            continue

        try:
            pre = classifier._rule_based_classify(f"{title} {desc[:200]}")
            if pre["severity"] < 0.35:
                continue

            cls_dict = pre
            if pre["severity"] >= 0.4 and llm_count < 40:
                try:
                    result = classifier.classify(text=desc[:600], title=title)
                    cls_dict = result.model_dump()
                    llm_count += 1
                except Exception:
                    pass

            event_id = hashlib.md5(f"{title}{date_s}".encode()).hexdigest()[:16]
            classified.append({
                "event_id": event_id,
                "title": title,
                "url": url,
                "date": date_s,
                "countries": countries,
                "countries_involved": countries,   # events.py uses this key
                "event_type": cls_dict.get("event_type", cls_dict.get("event_category", "GEOPOLITICAL")),
                "severity": float(cls_dict.get("severity", 0.5)),
                "affected_sectors": cls_dict.get("affected_sectors", []),
                "summary": desc[:400] or title,
                "source_url": url,
            })
        except Exception as e:
            logger.debug(f"  Skip: {e}")

    logger.info(f"  Classified: {len(classified)} events ({llm_count} via Groq LLM)")

    if not classified:
        logger.warning("No events passed threshold.")
        return 0

    # ── Step 3a: Save to local JSON cache (always works) ───────────────
    logger.info("Step 3/3 - Saving to local cache + Neo4j...")
    existing = load_existing_cache()
    for ev in classified:
        existing[ev["event_id"]] = ev

    # Keep the 500 most recent events
    all_events = sorted(existing.values(), key=lambda e: e.get("date", ""), reverse=True)[:500]
    save_cache(all_events)

    # ── Step 3b: Write to Neo4j (if online) ───────────────────────────
    neo_written = await write_to_neo4j(classified)
    if neo_written:
        logger.info(f"  Neo4j: {neo_written} events written")

    elapsed = time.time() - start
    new_count = len(classified)
    logger.info(f"Done in {elapsed:.1f}s — {new_count} new events cached, {neo_written} in Neo4j")
    logger.info("The backend will serve these events immediately (no restart needed).")
    return new_count


def main():
    parser = argparse.ArgumentParser(description="Sarwagya standalone pipeline")
    parser.add_argument("--loop", type=int, default=0, metavar="MINUTES",
                        help="Loop every N minutes (default: run once)")
    args = parser.parse_args()

    if args.loop:
        logger.info(f"Looping every {args.loop} min. Ctrl+C to stop.")
        while True:
            try:
                asyncio.run(run_once())
            except KeyboardInterrupt:
                break
            except Exception as e:
                logger.error(f"Pipeline error: {e}", exc_info=True)
            logger.info(f"Next run in {args.loop} min...")
            time.sleep(args.loop * 60)
    else:
        asyncio.run(run_once())


if __name__ == "__main__":
    main()




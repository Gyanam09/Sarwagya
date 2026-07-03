"""
collector/main.py — Data Collector Agent for Sarwagya
Fetches from: GDELT, World Bank, UN Comtrade, REST Countries,
              NewsAPI, ACLED, Wikidata, UN Voting
Runs on schedule via Airflow or APScheduler.
All sources are FREE.
"""
import asyncio
import httpx
import logging
from datetime import datetime, timedelta
from typing import Optional
import json

logger = logging.getLogger(__name__)

# ── Base collector ────────────────────────────────────────────────────────

class BaseCollector:
    """Common HTTP client with retry + backoff."""
    def __init__(self):
        self.client = httpx.AsyncClient(
            timeout=30.0,
            headers={"User-Agent": "Sarwagya/0.1 (geopolitical-intelligence)"},
            follow_redirects=True,
        )

    async def fetch(self, url: str, params: dict = None, retries: int = 3) -> dict:
        for attempt in range(retries):
            try:
                r = await self.client.get(url, params=params)
                r.raise_for_status()
                return r.json()
            except Exception as e:
                if attempt == retries - 1:
                    logger.error(f"Failed to fetch {url}: {e}")
                    raise
                await asyncio.sleep(2 ** attempt)

    async def close(self):
        await self.client.aclose()


# ── GDELT Collector (no API key needed) ──────────────────────────────────

class GDELTCollector(BaseCollector):
    """
    Fetches real-time global events from GDELT Project.
    No API key needed. Updates every 15 minutes.
    """
    BASE = "https://api.gdeltproject.org/api/v2/doc/doc"

    async def fetch_events(
        self,
        query: str = "country",
        mode: str = "ArtList",
        maxrecords: int = 100,
        timespan: str = "1h",
    ) -> list[dict]:
        params = {
            "query": query,
            "mode": mode,
            "maxrecords": maxrecords,
            "timespan": timespan,
            "format": "json",
        }
        data = await self.fetch(self.BASE, params=params)
        articles = data.get("articles", [])
        logger.info(f"GDELT: fetched {len(articles)} articles")
        return articles

    async def fetch_country_events(self, country_iso: str, hours: int = 24) -> list[dict]:
        """Fetch events mentioning a specific country."""
        return await self.fetch_events(
            query=f"sourcelang:english {country_iso}",
            timespan=f"{hours}h",
        )

    async def fetch_tone_trends(self, country_a: str, country_b: str) -> dict:
        """Get sentiment tone between two countries from GDELT."""
        params = {
            "query": f"{country_a} {country_b}",
            "mode": "TimelineSourceCountry",
            "timespan": "1m",
            "format": "json",
        }
        return await self.fetch(self.BASE, params=params)


# ── World Bank Collector (no API key needed) ──────────────────────────────

class WorldBankCollector(BaseCollector):
    BASE = "https://api.worldbank.org/v2"

    INDICATORS = {
        "gdp": "NY.GDP.MKTP.CD",
        "gdp_growth": "NY.GDP.MKTP.KD.ZG",
        "exports": "NE.EXP.GNFS.CD",
        "imports": "NE.IMP.GNFS.CD",
        "fdi_inflows": "BX.KLT.DINV.CD.WD",
        "inflation": "FP.CPI.TOTL.ZG",
        "population": "SP.POP.TOTL",
        "trade_pct_gdp": "NE.TRD.GNFS.ZS",
        "political_stability": "PV.EST",
        "gov_effectiveness": "GE.EST",
    }

    async def fetch_indicator(
        self,
        country_iso2: str,
        indicator: str,
        years: int = 10,
    ) -> list[dict]:
        end_year = datetime.now().year - 1
        start_year = end_year - years
        url = f"{self.BASE}/country/{country_iso2}/indicator/{indicator}"
        params = {
            "format": "json",
            "date": f"{start_year}:{end_year}",
            "per_page": 50,
        }
        data = await self.fetch(url, params=params)
        # World Bank returns [metadata, data_array]
        if isinstance(data, list) and len(data) > 1:
            return data[1] or []
        return []

    async def fetch_all_indicators(self, country_iso2: str) -> dict:
        results = {}
        for name, code in self.INDICATORS.items():
            try:
                results[name] = await self.fetch_indicator(country_iso2, code)
                await asyncio.sleep(0.3)  # gentle rate limiting
            except Exception as e:
                logger.warning(f"World Bank: failed {name} for {country_iso2}: {e}")
                results[name] = []
        return results


# ── REST Countries (no API key needed) ────────────────────────────────────

class RestCountriesCollector(BaseCollector):
    BASE = "https://countries.dev"

    async def fetch_all_countries(self) -> list[dict]:
        """Fetch metadata for all 250 countries."""
        data = await self.fetch(f"{self.BASE}/countries")
        logger.info(f"REST Countries: fetched {len(data)} countries")
        return data

    def parse_country(self, raw: dict) -> dict:
        """Normalize to Sarwagya format."""
        langs = [l.get("name") for l in raw.get("languages", []) if l.get("name")]
        currs = [c.get("code") for c in raw.get("currencies", []) if c.get("code")]
        return {
            "iso3": raw.get("alpha3Code", ""),
            "iso2": raw.get("alpha2Code", ""),
            "name": raw.get("name", ""),
            "official_name": raw.get("name", ""),
            "region": raw.get("region", ""),
            "subregion": raw.get("subregion", ""),
            "capital": raw.get("capital", ""),
            "population": raw.get("population"),
            "area_km2": raw.get("area"),
            "languages": langs,
            "currencies": currs,
            "borders": raw.get("borders", []),
            "lat": raw.get("latlng", [None, None])[0] if raw.get("latlng") else None,
            "lon": raw.get("latlng", [None, None])[1] if raw.get("latlng") else None,
            "un_member": raw.get("independent", False),
        }


# ── NewsAPI Collector (1000 req/day free) ─────────────────────────────────

class NewsAPICollector(BaseCollector):
    BASE = "https://newsapi.org/v2"

    def __init__(self, api_key: str):
        super().__init__()
        self.api_key = api_key

    async def fetch_geopolitical_news(
        self,
        query: str = "geopolitics sanctions trade war diplomacy",
        days_back: int = 1,
        language: str = "en",
        page_size: int = 100,
    ) -> list[dict]:
        from_date = (datetime.utcnow() - timedelta(days=days_back)).strftime("%Y-%m-%d")
        params = {
            "q": query,
            "from": from_date,
            "language": language,
            "pageSize": page_size,
            "apiKey": self.api_key,
            "sortBy": "publishedAt",
        }
        data = await self.fetch(f"{self.BASE}/everything", params=params)
        articles = data.get("articles", [])
        logger.info(f"NewsAPI: fetched {len(articles)} articles")
        return articles


# ── UN Comtrade (free registration) ──────────────────────────────────────

class ComtradeCollector(BaseCollector):
    BASE = "https://comtradeapi.un.org/data/v1/get"

    def __init__(self, api_key: str = ""):
        super().__init__()
        self.api_key = api_key

    async def fetch_trade(
        self,
        reporter_iso3: str,
        partner_iso3: str = "all",
        year: Optional[int] = None,
        flow: str = "X",  # X=exports, M=imports
    ) -> dict:
        year = year or (datetime.now().year - 1)
        params = {
            "typeCode": "C",
            "freqCode": "A",
            "clCode": "HS",
            "reporterCode": reporter_iso3,
            "partnerCode": partner_iso3,
            "period": str(year),
            "flowCode": flow,
            "maxRecords": 500,
        }
        if self.api_key:
            params["subscription-key"] = self.api_key
        return await self.fetch(self.BASE, params=params)


# ── UCDP Collector (free academic registration via email) ──────────────────

class UCDPCollector(BaseCollector):
    """
    Fetches event-level conflict data from Uppsala Conflict Data Program (UCDP).
    Requires a token passed via the x-ucdp-access-token header.
    """
    BASE = "https://ucdpapi.pcr.uu.se/api/gedevents"

    def __init__(self, token: str = "", version: str = "23.1"):
        super().__init__()
        self.token = token
        self.version = version
        if token:
            self.client.headers["x-ucdp-access-token"] = token

    async def fetch_events(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        country: Optional[int] = None,
        page: int = 1,
        pagesize: int = 100,
    ) -> dict:
        """
        Fetch UCDP GED events for a given period or country.
        """
        if not self.token or self.token == "your-ucdp-token":
            logger.warning("UCDP token is missing or placeholder. Skipping UCDP fetch.")
            return {"Result": [], "TotalCount": 0}

        url = f"{self.BASE}/{self.version}"
        params = {
            "page": page,
            "pagesize": pagesize,
        }
        if start_date:
            params["StartDate"] = start_date
        if end_date:
            params["EndDate"] = end_date
        if country:
            params["Country"] = country

        try:
            data = await self.fetch(url, params=params)
            if isinstance(data, list):
                return {"Result": data, "TotalCount": len(data)}
            elif isinstance(data, dict):
                if "Result" in data:
                    return data
                return {"Result": [data], "TotalCount": 1}
            return {"Result": [], "TotalCount": 0}
        except Exception as e:
            logger.error(f"UCDP: failed to fetch events: {e}")
            return {"Result": [], "TotalCount": 0}


# ── Orchestrator: runs all collectors ────────────────────────────────────

class CollectorOrchestrator:
    def __init__(self, settings):
        self.gdelt = GDELTCollector()
        self.worldbank = WorldBankCollector()
        self.rest_countries = RestCountriesCollector()
        self.news = NewsAPICollector(api_key=getattr(settings, "NEWS_API_KEY", ""))
        self.comtrade = ComtradeCollector(api_key=getattr(settings, "COMTRADE_KEY", ""))
        self.ucdp = UCDPCollector(
            token=getattr(settings, "UCDP_TOKEN", ""),
            version=getattr(settings, "UCDP_VERSION", "23.1")
        )

    async def run_daily(self):
        """Full daily data refresh."""
        logger.info("=== Sarwagya Daily Collector Starting ===")

        # 1. Refresh all country metadata
        logger.info("Step 1: Refreshing country metadata...")
        raw_countries = await self.rest_countries.fetch_all_countries()
        countries = [self.rest_countries.parse_country(c) for c in raw_countries]
        logger.info(f"  → {len(countries)} countries fetched")

        # 2. Fetch GDELT events (last 24h)
        logger.info("Step 2: GDELT news events (last 24h)...")
        events = await self.gdelt.fetch_events(
            query="country government sanctions trade war diplomacy military",
            timespan="24h",
            maxrecords=250,
        )
        logger.info(f"  → {len(events)} events fetched")

        # 3. NewsAPI headlines
        logger.info("Step 3: News headlines...")
        try:
            news = await self.news.fetch_geopolitical_news(days_back=1)
        except Exception as e:
            logger.warning(f"NewsAPI: failed to fetch geopolitical news: {e}")
            news = []
        logger.info(f"  → {len(news)} articles fetched")

        # 4. UCDP conflict events
        logger.info("Step 4: UCDP conflict events (last 24h)...")
        yesterday_str = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
        today_str = datetime.utcnow().strftime("%Y-%m-%d")
        try:
            ucdp_data = await self.ucdp.fetch_events(start_date=yesterday_str, end_date=today_str)
            ucdp_events = ucdp_data.get("Result", [])
        except Exception as e:
            logger.warning(f"UCDP: failed to fetch daily events: {e}")
            ucdp_events = []
        logger.info(f"  → {len(ucdp_events)} UCDP events fetched")

        logger.info("=== Daily collection complete ===")
        return {
            "countries": countries,
            "gdelt_events": events,
            "news": news,
            "ucdp_events": ucdp_events,
            "collected_at": datetime.utcnow().isoformat(),
        }

    async def run_realtime(self):
        """Lightweight 15-minute refresh — just GDELT + news."""
        events = await self.gdelt.fetch_events(timespan="15m", maxrecords=50)
        return {"gdelt_events": events, "collected_at": datetime.utcnow().isoformat()}

    async def close(self):
        await self.gdelt.close()
        await self.worldbank.close()
        await self.rest_countries.close()
        await self.news.close()
        await self.comtrade.close()
        await self.ucdp.close()


if __name__ == "__main__":
    import os
    from dotenv import load_dotenv
    from pathlib import Path
    root_dir = Path(__file__).resolve().parent.parent.parent
    load_dotenv(dotenv_path=root_dir / "backend" / ".env")

    class FakeSettings:
        NEWS_API_KEY = os.getenv("NEWS_API_KEY", "")
        COMTRADE_KEY = os.getenv("COMTRADE_KEY", "")
        UCDP_TOKEN = os.getenv("UCDP_TOKEN", "")
        UCDP_VERSION = os.getenv("UCDP_VERSION", "23.1")

    async def main():
        orch = CollectorOrchestrator(FakeSettings())
        result = await orch.run_daily()
        print(json.dumps(result, indent=2, default=str))
        await orch.close()

    asyncio.run(main())

"""
services/country_service.py — Country data service
Fetches and normalizes country data from REST Countries API + local cache.
"""
import httpx
import logging
from typing import Optional
from pydantic import BaseModel

logger = logging.getLogger(__name__)

REST_COUNTRIES_BASE = "https://countries.dev"


class CountryProfile(BaseModel):
    iso3: str
    name: str
    region: str
    population: Optional[int] = None
    gdp_usd: Optional[float] = None
    gdp_growth: Optional[float] = None
    trade_openness: Optional[float] = None
    political_stability: Optional[float] = None
    democracy_score: Optional[float] = None


class CountryService:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=15.0, follow_redirects=True)

    async def get_all(
        self,
        region: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[CountryProfile]:
        try:
            url = f"{REST_COUNTRIES_BASE}/countries"
            r = await self.client.get(url)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            logger.error(f"countries.dev API error: {e}")
            return []

        countries = []
        for c in data:
            try:
                profile = self._parse(c)
                if region and profile.region.lower() != region.lower():
                    continue
                if search and search.lower() not in profile.name.lower() and search.lower() not in profile.iso3.lower():
                    continue
                countries.append(profile)
            except Exception:
                pass
        return countries[offset: offset + limit]

    async def get_by_iso3(self, iso3: str) -> Optional[CountryProfile]:
        try:
            # Fetch all and filter locally for robustness and schema compatibility
            url = f"{REST_COUNTRIES_BASE}/countries"
            r = await self.client.get(url)
            r.raise_for_status()
            data = r.json()
            for c in data:
                if c.get("alpha3Code", "").lower() == iso3.lower() or c.get("alpha2Code", "").lower() == iso3.lower():
                    return self._parse(c)
            return None
        except Exception as e:
            logger.error(f"Country fetch error for {iso3}: {e}")
            return None

    def _parse(self, raw: dict) -> CountryProfile:
        return CountryProfile(
            iso3=raw.get("alpha3Code", ""),
            name=raw.get("name", ""),
            region=raw.get("region", ""),
            population=raw.get("population"),
        )

    async def close(self):
        await self.client.aclose()

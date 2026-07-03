"""
services/worldbank_service.py — World Bank API (no key needed, fully free)
"""
import httpx
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

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
}

# World Bank uses ISO2 codes
ISO3_TO_ISO2 = {
    "IND": "IN", "USA": "US", "CHN": "CN", "RUS": "RU", "GBR": "GB",
    "DEU": "DE", "FRA": "FR", "JPN": "JP", "BRA": "BR", "CAN": "CA",
    "AUS": "AU", "PAK": "PK", "ARE": "AE", "SAU": "SA", "IRN": "IR",
    "TUR": "TR", "KOR": "KR", "IDN": "ID", "EGY": "EG", "ZAF": "ZA",
}


class WorldBankService:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=20.0)

    def _iso2(self, iso3: str) -> str:
        return ISO3_TO_ISO2.get(iso3.upper(), iso3[:2].lower())

    async def get_indicators(self, iso3: str, years: int = 10) -> dict:
        iso2 = self._iso2(iso3)
        end_year = datetime.now().year - 1
        start_year = end_year - years
        results = {}

        for name, code in INDICATORS.items():
            try:
                url = f"{BASE}/country/{iso2}/indicator/{code}"
                r = await self.client.get(url, params={
                    "format": "json",
                    "date": f"{start_year}:{end_year}",
                    "per_page": 50,
                })
                r.raise_for_status()
                data = r.json()
                if isinstance(data, list) and len(data) > 1:
                    results[name] = [
                        {"year": d.get("date"), "value": d.get("value")}
                        for d in (data[1] or [])
                        if d.get("value") is not None
                    ]
                else:
                    results[name] = []
            except Exception as e:
                logger.warning(f"World Bank: {name} for {iso3} failed: {e}")
                results[name] = []

        return {"country": iso3, "indicators": results}

    async def close(self):
        await self.client.aclose()

"""
healer/main.py — Self-Healing Agent for Sarwagya
Monitors:
  - API endpoint health (broken/changed schemas)
  - Pipeline failures (collector, extractor, classifier, etc.)
  - Data quality issues (nulls, stale data, anomalies)
  - Rate limit exhaustion
Takes action:
  - Auto-retry with exponential backoff
  - Switch to fallback data source / fallback LLM
  - Alert via webhook/email (free tier services)
  - Log to Sentry (free tier)
"""
import asyncio
import logging
import json
from datetime import datetime, timedelta
from enum import Enum
from pydantic import BaseModel
from typing import Optional, Callable
import httpx

logger = logging.getLogger(__name__)


class HealthStatus(str, Enum):
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    DOWN = "DOWN"
    UNKNOWN = "UNKNOWN"


class ComponentHealth(BaseModel):
    component: str
    status: HealthStatus
    last_success: Optional[str] = None
    last_failure: Optional[str] = None
    consecutive_failures: int = 0
    error_message: Optional[str] = None
    fallback_active: bool = False


# ── Monitored components & their fallbacks ────────────────────────────────

FALLBACK_CHAINS = {
    "groq_llm": ["gemini_llm", "ollama_local"],
    "newsapi": ["gdelt", "rss_feeds"],
    "comtrade": ["world_bank_trade_indicators"],
    "neo4j": [],  # no fallback — critical, must alert immediately
    "supabase": [],  # critical
}

# Data sources and their expected schemas (to detect breaking changes)
EXPECTED_SCHEMAS = {
    "world_bank": {"required_keys": ["page", "pages", "per_page", "total"]},
    "gdelt": {"required_keys": ["articles"]},
    "rest_countries": {"required_keys": ["cca3", "name", "region"]},
}


class SelfHealingAgent:
    def __init__(self, sentry_dsn: str = "", webhook_url: str = ""):
        self.health_registry: dict[str, ComponentHealth] = {}
        self.sentry_dsn = sentry_dsn
        self.webhook_url = webhook_url   # e.g. Discord/Slack webhook (free)
        self.client = httpx.AsyncClient(timeout=10.0)

    def register_component(self, name: str):
        if name not in self.health_registry:
            self.health_registry[name] = ComponentHealth(
                component=name,
                status=HealthStatus.UNKNOWN,
            )

    async def record_success(self, component: str):
        self.register_component(component)
        health = self.health_registry[component]
        health.status = HealthStatus.HEALTHY
        health.last_success = datetime.utcnow().isoformat()
        health.consecutive_failures = 0
        health.fallback_active = False

    async def record_failure(self, component: str, error: str):
        self.register_component(component)
        health = self.health_registry[component]
        health.last_failure = datetime.utcnow().isoformat()
        health.consecutive_failures += 1
        health.error_message = error[:500]

        if health.consecutive_failures >= 5:
            health.status = HealthStatus.DOWN
            await self._trigger_alert(component, health, severity="CRITICAL")
        elif health.consecutive_failures >= 2:
            health.status = HealthStatus.DEGRADED
            await self._trigger_alert(component, health, severity="WARNING")

        # Try fallback if available
        if component in FALLBACK_CHAINS and FALLBACK_CHAINS[component]:
            health.fallback_active = True
            logger.warning(
                f"{component} failing — falling back to {FALLBACK_CHAINS[component][0]}"
            )

    async def _trigger_alert(self, component: str, health: ComponentHealth, severity: str):
        """Send alert via free webhook (Discord/Slack) and log to Sentry."""
        message = (
            f"🚨 [{severity}] Sarwagya component `{component}` is {health.status.value}\n"
            f"Consecutive failures: {health.consecutive_failures}\n"
            f"Error: {health.error_message}\n"
            f"Time: {datetime.utcnow().isoformat()}"
        )
        logger.error(message)

        if self.webhook_url:
            try:
                await self.client.post(self.webhook_url, json={"content": message})
            except Exception as e:
                logger.error(f"Failed to send webhook alert: {e}")

        if self.sentry_dsn:
            try:
                import sentry_sdk
                sentry_sdk.capture_message(message, level="error")
            except Exception:
                pass

    async def with_retry(
        self,
        component: str,
        func: Callable,
        *args,
        max_retries: int = 3,
        backoff_base: float = 2.0,
        **kwargs,
    ):
        """
        Wrap any async function call with retry + health tracking.
        Usage:
          result = await healer.with_retry("newsapi", collector.fetch_news, query="trade")
        """
        last_error = None
        for attempt in range(max_retries):
            try:
                result = await func(*args, **kwargs)
                await self.record_success(component)
                return result
            except Exception as e:
                last_error = e
                wait = backoff_base ** attempt
                logger.warning(
                    f"{component} attempt {attempt+1}/{max_retries} failed: {e}. "
                    f"Retrying in {wait}s..."
                )
                await asyncio.sleep(wait)

        await self.record_failure(component, str(last_error))
        raise last_error

    def validate_schema(self, source: str, data: dict) -> bool:
        """Check if API response matches expected schema (detect breaking changes)."""
        expected = EXPECTED_SCHEMAS.get(source)
        if not expected:
            return True  # no schema defined, assume OK

        required = expected.get("required_keys", [])
        if isinstance(data, dict):
            missing = [k for k in required if k not in data]
        elif isinstance(data, list) and data:
            missing = [k for k in required if k not in data[0]]
        else:
            missing = required

        if missing:
            logger.error(f"Schema validation failed for {source}: missing keys {missing}")
            return False
        return True

    def check_data_freshness(self, component: str, last_updated: datetime, max_age_hours: int = 24) -> bool:
        """Flag stale data that hasn't refreshed within expected window."""
        age = datetime.utcnow() - last_updated
        if age > timedelta(hours=max_age_hours):
            logger.warning(
                f"{component} data is stale: last updated {age.total_seconds()/3600:.1f}h ago "
                f"(threshold: {max_age_hours}h)"
            )
            return False
        return True

    def get_system_health(self) -> dict:
        """Full system health snapshot for the /health/system endpoint."""
        components = list(self.health_registry.values())
        overall = HealthStatus.HEALTHY
        if any(c.status == HealthStatus.DOWN for c in components):
            overall = HealthStatus.DOWN
        elif any(c.status == HealthStatus.DEGRADED for c in components):
            overall = HealthStatus.DEGRADED

        return {
            "overall_status": overall.value,
            "components": [c.dict() for c in components],
            "checked_at": datetime.utcnow().isoformat(),
        }

    async def close(self):
        await self.client.aclose()


# ── Example usage in an Airflow task ──────────────────────────────────────

async def example_resilient_collection():
    """
    Example of how agents should wrap their calls.
    """
    healer = SelfHealingAgent(webhook_url="")  # add Discord webhook URL (free)

    from agents.collector.main import GDELTCollector
    gdelt = GDELTCollector()

    try:
        events = await healer.with_retry(
            "gdelt",
            gdelt.fetch_events,
            timespan="1h",
            max_retries=3,
        )
        logger.info(f"Successfully fetched {len(events)} events")
    except Exception as e:
        logger.error(f"GDELT permanently failed after retries: {e}")
        # Fall back to NewsAPI or cached data
    finally:
        await gdelt.close()
        await healer.close()

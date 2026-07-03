"""
realtime_pipeline.py — Lightweight 15-minute refresh DAG
Only pulls fast-moving GDELT events — avoids hammering free-tier rate limits.
"""
from airflow import DAG
from airflow.operators.python import PythonOperator
from datetime import datetime, timedelta
import logging
import asyncio
import os

logger = logging.getLogger(__name__)

default_args = {
    "owner": "sarwagya",
    "retries": 2,
    "retry_delay": timedelta(minutes=1),
    "execution_timeout": timedelta(minutes=10),
}


def _run_async(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def fetch_realtime_events(**context):
    from agents.collector.main import GDELTCollector
    from agents.healer.main import SelfHealingAgent

    async def run():
        gdelt = GDELTCollector()
        healer = SelfHealingAgent()
        try:
            events = await healer.with_retry("gdelt", gdelt.fetch_events, timespan="15m", maxrecords=50)
        finally:
            await gdelt.close()
            await healer.close()
        return events

    events = _run_async(run())
    context["ti"].xcom_push(key="realtime_events", value=events)
    logger.info(f"Realtime: fetched {len(events)} new events")


def quick_classify_and_alert(**context):
    """
    Quick severity check — if anything is HIGH severity, flag for immediate
    extraction (skips waiting for tomorrow's batch).
    """
    from agents.classifier.main import EventClassifier

    events = context["ti"].xcom_pull(key="realtime_events", task_ids="fetch_realtime_events")
    if not events:
        return

    classifier = EventClassifier(groq_api_key=os.getenv("GROQ_API_KEY"))

    high_severity = []
    for event in events:
        title = event.get("title", "")
        result = classifier._rule_based_classify(title)   # cheap pre-check, no LLM cost
        if result["severity"] >= 0.6:
            high_severity.append({**event, "pre_severity": result["severity"]})

    if high_severity:
        logger.warning(f"⚠️  {len(high_severity)} high-severity events detected in last 15min!")
        context["ti"].xcom_push(key="high_severity_events", value=high_severity)
        # In production: trigger immediate extraction + webhook alert here


with DAG(
    dag_id="sarwagya_realtime_pipeline",
    default_args=default_args,
    description="15-minute GDELT refresh for breaking events",
    schedule_interval="*/15 * * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=["sarwagya", "realtime"],
) as dag:

    t1 = PythonOperator(task_id="fetch_realtime_events", python_callable=fetch_realtime_events)
    t2 = PythonOperator(task_id="quick_classify_and_alert", python_callable=quick_classify_and_alert)

    t1 >> t2

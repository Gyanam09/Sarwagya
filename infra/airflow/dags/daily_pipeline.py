"""
daily_pipeline.py — Main Sarwagya Airflow DAG
Runs once a day: Collector → Extractor → Classifier → Graph Updater → Reporter
Free-tier friendly: single worker, modest batch sizes, generous retries.
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
    "depends_on_past": False,
    "retries": 3,
    "retry_delay": timedelta(minutes=5),
    "execution_timeout": timedelta(minutes=45),
}


def _run_async(coro):
    """Helper to run async code inside Airflow's sync PythonOperator."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def collect_data(**context):
    """Task 1: Fetch from all free data sources."""
    from agents.collector.main import CollectorOrchestrator

    class Settings:
        NEWS_API_KEY = os.getenv("NEWS_API_KEY", "")
        COMTRADE_KEY = os.getenv("COMTRADE_KEY", "")
        UCDP_TOKEN = os.getenv("UCDP_TOKEN", "")
        UCDP_VERSION = os.getenv("UCDP_VERSION", "23.1")

    async def run():
        orch = CollectorOrchestrator(Settings())
        result = await orch.run_daily()
        await orch.close()
        return result

    result = _run_async(run())
    context["ti"].xcom_push(key="raw_data", value=result)
    logger.info(f"Collected {len(result.get('news', []))} news + {len(result.get('gdelt_events', []))} GDELT events + {len(result.get('ucdp_events', []))} UCDP events")


def extract_entities(**context):
    """Task 2: NER + relation extraction from collected news."""
    from agents.extractor.main import BatchExtractor

    raw_data = context["ti"].xcom_pull(key="raw_data", task_ids="collect_data")
    articles = raw_data.get("news", []) + raw_data.get("gdelt_events", [])

    # Map UCDP events to article format for entity extraction
    ucdp_events = raw_data.get("ucdp_events", [])
    for event in ucdp_events:
        event_id = event.get("id", "")
        country = event.get("country", "")
        conflict_name = event.get("conflict_name", "")
        date_start = event.get("date_start", "")
        best_deaths = event.get("best", 0)

        title = f"Conflict Event: {conflict_name} in {country}"
        description = f"A conflict event occurred on {date_start} in {country} involving {conflict_name}. Estimated fatalities: {best_deaths}."

        articles.append({
            "title": title,
            "description": description,
            "url": f"https://ucdp.uu.se/event/{event_id}" if event_id else "",
            "publishedAt": date_start,
        })

    async def run():
        extractor = BatchExtractor(groq_api_key=os.getenv("GROQ_API_KEY"))
        return await extractor.process_articles(articles)

    extractions = _run_async(run())
    context["ti"].xcom_push(key="extractions", value=extractions)
    logger.info(f"Extracted entities from {len(extractions)} articles")


def classify_events(**context):
    """Task 3: Classify extracted events by type/severity/sector."""
    from agents.classifier.main import EventClassifier

    extractions = context["ti"].xcom_pull(key="extractions", task_ids="extract_entities")

    classifier = EventClassifier(groq_api_key=os.getenv("GROQ_API_KEY"))
    classified = classifier.classify_batch(extractions)

    context["ti"].xcom_push(key="classified_events", value=classified)
    logger.info(f"Classified {len(classified)} events")


def update_graph(**context):
    """Task 4: Write countries + events + relationships to Neo4j."""
    from agents.graph_updater.main import GraphUpdater

    raw_data = context["ti"].xcom_pull(key="raw_data", task_ids="collect_data")
    classified_events = context["ti"].xcom_pull(key="classified_events", task_ids="classify_events")

    async def run():
        updater = GraphUpdater(
            neo4j_uri=os.getenv("NEO4J_URI"),
            neo4j_user=os.getenv("NEO4J_USER", "neo4j"),
            neo4j_password=os.getenv("NEO4J_PASSWORD"),
        )
        await updater.init_schema()
        await updater.upsert_all_countries(raw_data.get("countries", []))

        for event in classified_events:
            extraction = event.get("extraction", {})
            source_meta = {
                "title": event.get("title", ""),
                "source_url": event.get("source_url", event.get("url", "")),
            }
            try:
                await updater.process_extraction_result(extraction, source_meta)
            except Exception as e:
                logger.warning(f"Failed to write event to graph: {e}")

        await updater.close()

    _run_async(run())
    logger.info("Graph update complete")


def generate_daily_digest(**context):
    """Task 5: Generate the daily intelligence digest report."""
    from agents.reporter.main import ReportGenerator
    import redis as redis_lib
    import json

    classified_events = context["ti"].xcom_pull(key="classified_events", task_ids="classify_events")
    top_events = sorted(
        classified_events,
        key=lambda e: e.get("classification", {}).get("severity", 0),
        reverse=True,
    )[:15]

    async def run():
        generator = ReportGenerator(
            groq_api_key=os.getenv("GROQ_API_KEY"),
            gemini_api_key=os.getenv("GEMINI_API_KEY", ""),
        )
        return await generator.daily_digest(top_events)

    digest = _run_async(run())

    # Cache in Redis for the /reports/daily-digest endpoint
    r = redis_lib.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))
    cache_key = f"digest:{datetime.utcnow().strftime('%Y-%m-%d')}"
    r.setex(cache_key, 86400, json.dumps(digest.dict(), default=str))
    logger.info("Daily digest generated and cached")


with DAG(
    dag_id="sarwagya_daily_pipeline",
    default_args=default_args,
    description="Daily data collection → extraction → classification → graph → digest",
    schedule_interval="0 3 * * *",   # 3 AM UTC daily
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=["sarwagya", "daily"],
) as dag:

    t1 = PythonOperator(task_id="collect_data", python_callable=collect_data)
    t2 = PythonOperator(task_id="extract_entities", python_callable=extract_entities)
    t3 = PythonOperator(task_id="classify_events", python_callable=classify_events)
    t4 = PythonOperator(task_id="update_graph", python_callable=update_graph)
    t5 = PythonOperator(task_id="generate_daily_digest", python_callable=generate_daily_digest)

    t1 >> t2 >> t3 >> t4 >> t5

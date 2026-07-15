"""
pipeline.py — Airflow pipeline trigger & status endpoints
Allows the frontend to kick off DAG runs and poll their status via Airflow REST API.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from app.core.security import require_analyst, TokenData
from app.core.config import settings
import httpx
import logging
from datetime import datetime

router = APIRouter()
logger = logging.getLogger(__name__)

AIRFLOW_BASE = getattr(settings, "AIRFLOW_BASE_URL", "http://localhost:8080")
AIRFLOW_USER = getattr(settings, "AIRFLOW_USER", "airflow")
AIRFLOW_PASS = getattr(settings, "AIRFLOW_PASSWORD", "airflow")

AIRFLOW_AUTH = (AIRFLOW_USER, AIRFLOW_PASS)
KNOWN_DAGS = {"sarwagya_daily_pipeline", "sarwagya_realtime_pipeline"}


async def _airflow_request(method: str, path: str, **kwargs):
    """Make an authenticated request to the Airflow REST API."""
    url = f"{AIRFLOW_BASE}/api/v1/{path}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.request(method, url, auth=AIRFLOW_AUTH, **kwargs)
            res.raise_for_status()
            return res.json()
    except httpx.ConnectError:
        raise HTTPException(503, "Airflow is not running. Start with: docker compose up airflow-scheduler airflow-webserver")
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"Airflow API error: {e.response.text}")


@router.post("/trigger/{dag_id}")
async def trigger_pipeline(
    dag_id: str,
    current_user: TokenData = Depends(require_analyst),
):
    """Trigger an Airflow DAG run manually."""
    if dag_id not in KNOWN_DAGS:
        raise HTTPException(404, f"Unknown DAG: {dag_id}. Known DAGs: {list(KNOWN_DAGS)}")

    run_id = f"manual__{datetime.utcnow().strftime('%Y%m%dT%H%M%S')}__{current_user.user_id[:8]}"
    result = await _airflow_request(
        "POST",
        f"dags/{dag_id}/dagRuns",
        json={"dag_run_id": run_id, "logical_date": datetime.utcnow().isoformat() + "Z"},
    )
    logger.info(f"Pipeline triggered: {dag_id} run_id={run_id} by user={current_user.email}")
    return {"dag_id": dag_id, "run_id": run_id, "state": result.get("state", "queued")}


@router.get("/status/{dag_id}")
async def pipeline_status(
    dag_id: str,
    run_id: str = Query(None, description="Specific run ID. Omit for latest run."),
    _: TokenData = Depends(require_analyst),
):
    """Get the status of a DAG run and its task instances."""
    if dag_id not in KNOWN_DAGS:
        raise HTTPException(404, f"Unknown DAG: {dag_id}")

    if run_id:
        run = await _airflow_request("GET", f"dags/{dag_id}/dagRuns/{run_id}")
    else:
        # Get the latest run
        runs = await _airflow_request(
            "GET", f"dags/{dag_id}/dagRuns",
            params={"limit": 1, "order_by": "-execution_date"},
        )
        dag_runs = runs.get("dag_runs", [])
        if not dag_runs:
            return {"dag_id": dag_id, "runs": [], "tasks": []}
        run = dag_runs[0]
        run_id = run["dag_run_id"]

    # Get task instances for this run
    tasks_data = await _airflow_request(
        "GET", f"dags/{dag_id}/dagRuns/{run_id}/taskInstances"
    )

    return {
        "dag_id": dag_id,
        "run_id": run_id,
        "state": run.get("state"),
        "start_date": run.get("start_date"),
        "end_date": run.get("end_date"),
        "logical_date": run.get("logical_date"),
        "tasks": [
            {
                "task_id": t["task_id"],
                "state": t["state"],
                "start_date": t.get("start_date"),
                "end_date": t.get("end_date"),
                "duration": t.get("duration"),
            }
            for t in tasks_data.get("task_instances", [])
        ],
    }


@router.get("/runs")
async def list_pipeline_runs(
    dag_id: str = Query("sarwagya_daily_pipeline"),
    limit: int = Query(5, le=20),
    _: TokenData = Depends(require_analyst),
):
    """List recent DAG runs."""
    if dag_id not in KNOWN_DAGS:
        raise HTTPException(404, f"Unknown DAG: {dag_id}")

    try:
        runs = await _airflow_request(
            "GET", f"dags/{dag_id}/dagRuns",
            params={"limit": limit, "order_by": "-execution_date"},
        )
        return {"dag_id": dag_id, "runs": runs.get("dag_runs", [])}
    except HTTPException as e:
        if e.status_code == 503:
            # Airflow not running — return placeholder
            return {
                "dag_id": dag_id,
                "runs": [],
                "note": "Airflow not running. Start with: docker compose up",
            }
        raise

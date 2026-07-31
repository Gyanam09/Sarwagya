"""
database.py — All DB connection managers for Sarwagya
- PostgreSQL via Supabase (async SQLAlchemy)
- Neo4j AuraDB (knowledge graph)
- Redis via Upstash (cache)
- Qdrant (vector search)
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool
from neo4j import AsyncGraphDatabase
from redis.asyncio import Redis
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams
import asyncpg
import logging
from typing import AsyncGenerator

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── PostgreSQL (Supabase) ─────────────────────────────────────────────────
# Supabase uses PgBouncer in transaction-pooling mode. asyncpg prepared
# statements are incompatible with this mode — the same statement name gets
# re-sent on a different server connection that doesn't know about it.
#
# The ONLY reliable fix is to pass statement_cache_size=0 to asyncpg's own
# connect() before SQLAlchemy's JSON/JSONB on_connect hooks run.  We do this
# by building the engine with a custom `creator` that calls asyncpg directly.




def _make_dsn() -> str:
    """Convert DATABASE_URL from postgresql+asyncpg:// to asyncpg-native DSN."""
    url = settings.DATABASE_URL
    for prefix in ("postgresql+asyncpg://", "postgres+asyncpg://"):
        if url.startswith(prefix):
            return "postgresql://" + url[len(prefix):]
    # Already a plain postgresql:// URL
    return url


_DSN = _make_dsn()


async def _asyncpg_connect():
    """Create an asyncpg connection with statement caching disabled."""
    return await asyncpg.connect(_DSN, statement_cache_size=0)


engine = create_async_engine(
    # Use a dummy URL — the real connection comes from the creator above.
    # We keep the postgresql+asyncpg scheme so SQLAlchemy loads the right
    # dialect; the host/credentials are irrelevant because creator overrides.
    "postgresql+asyncpg://placeholder/placeholder",
    async_creator=_asyncpg_connect,
    # NullPool: don't pool connections ourselves — PgBouncer pools for us.
    # This also avoids pool state leaking across uvicorn worker reloads.
    poolclass=NullPool,
    echo=settings.APP_ENV == "development",
)


AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ── Neo4j AuraDB ─────────────────────────────────────────────────────────

_neo4j_driver = None


def get_neo4j_driver():
    global _neo4j_driver
    if _neo4j_driver is None:
        _neo4j_driver = AsyncGraphDatabase.driver(
            settings.NEO4J_URI,
            auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
            max_connection_pool_size=10,   # free tier limit
            connection_timeout=3.0,
        )
    return _neo4j_driver


async def get_neo4j_session() -> AsyncGenerator:
    driver = get_neo4j_driver()
    async with driver.session() as session:
        yield session


async def close_neo4j():
    global _neo4j_driver
    if _neo4j_driver:
        await _neo4j_driver.close()
        _neo4j_driver = None


# ── Redis (Upstash free tier) ─────────────────────────────────────────────

_redis_client = None


def get_redis() -> Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = Redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
        )
    return _redis_client


# ── Qdrant (local or free cloud) ─────────────────────────────────────────

_qdrant_client = None

COLLECTIONS = {
    "news_embeddings": 384,      # sentence-transformers all-MiniLM-L6-v2
    "country_profiles": 384,
    "event_descriptions": 384,
}


def get_qdrant() -> QdrantClient:
    global _qdrant_client
    if _qdrant_client is None:
        kwargs = {"url": settings.QDRANT_URL}
        if settings.QDRANT_API_KEY:
            kwargs["api_key"] = settings.QDRANT_API_KEY
        _qdrant_client = QdrantClient(**kwargs)
    return _qdrant_client


async def init_qdrant_collections():
    """Create collections if they don't exist."""
    client = get_qdrant()
    existing = {c.name for c in client.get_collections().collections}
    for name, dim in COLLECTIONS.items():
        if name not in existing:
            client.create_collection(
                collection_name=name,
                vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
            )
            logger.info(f"Created Qdrant collection: {name}")


# ── Startup / Shutdown ────────────────────────────────────────────────────

async def connect_all():
    logger.info("Connecting to databases...")

    # Test PostgreSQL via raw asyncpg (bypasses SQLAlchemy dialect init which
    # uses prepared statements incompatible with PgBouncer transaction pooling).
    try:
        conn = await asyncpg.connect(_DSN, statement_cache_size=0)
        try:
            await conn.fetchval("SELECT 1")
            logger.info("PostgreSQL OK")
        finally:
            await conn.close()
    except Exception as e:
        logger.warning(
            f"PostgreSQL unavailable (project may be paused): {e}\n"
            "Auth/DB routes will fail until Postgres is reachable."
        )

    # Test Neo4j
    try:
        driver = get_neo4j_driver()
        async with driver.session() as s:
            await s.run("RETURN 1")
        logger.info("Neo4j OK")
    except Exception as e:
        logger.warning(f"Neo4j unavailable: {e}. Graph routes will return empty/seed data.")

    # Test Redis
    try:
        r = get_redis()
        await r.ping()
        logger.info("Redis OK")
    except Exception as e:
        logger.warning(f"Redis unavailable: {e}. Caching disabled.")

    # Init Qdrant
    try:
        await init_qdrant_collections()
        logger.info("Qdrant OK")
    except Exception as e:
        logger.warning(f"Qdrant unavailable: {e}. Vector search disabled.")


async def disconnect_all():
    await close_neo4j()
    r = get_redis()
    await r.close()
    await engine.dispose()
    logger.info("All DB connections closed")

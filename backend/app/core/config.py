# pyrefly: ignore [missing-import]
from pydantic_settings import BaseSettings
from pydantic import AnyHttpUrl
from typing import List
from functools import lru_cache


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Sarwagya"
    APP_ENV: str = "development"
    SECRET_KEY: str = "sarwagya-default-secret-key-change-in-prod"
    ALLOWED_ORIGINS: str = "http://localhost:3000"

    # Supabase
    SUPABASE_URL: str = "https://placeholder.supabase.co"
    SUPABASE_ANON_KEY: str = "placeholder-anon-key"
    SUPABASE_SERVICE_KEY: str = "placeholder-service-key"
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/sarwagya"

    # Neo4j
    NEO4J_URI: str = "neo4j+s://placeholder.databases.neo4j.io"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "placeholder-password"

    # Redis
    REDIS_URL: str = "redis://localhost:6379"
    UPSTASH_REDIS_URL: str = ""

    # Qdrant
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: str = ""

    # LLMs (free)
    GROQ_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    OLLAMA_BASE_URL: str = "http://localhost:11434"

    # Data sources
    COMTRADE_KEY: str = ""
    NEWS_API_KEY: str = ""
    UCDP_TOKEN: str = ""
    UCDP_VERSION: str = "23.1"
    WORLD_BANK_API: str = "https://api.worldbank.org/v2"
    GDELT_API: str = "https://api.gdeltproject.org/api/v2"
    REST_COUNTRIES_API: str = "https://restcountries.com/v3.1"
    WIKIDATA_SPARQL: str = "https://query.wikidata.org/sparql"

    # Monitoring
    SENTRY_DSN: str = ""

    # Rate limits
    RATE_LIMIT_PER_MINUTE: int = 60
    RATE_LIMIT_PER_DAY: int = 1000

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]

    @property
    def redis_url(self) -> str:
        # Prefer Upstash in production
        if self.APP_ENV == "production" and self.UPSTASH_REDIS_URL:
            return self.UPSTASH_REDIS_URL
        return self.REDIS_URL

    @property
    def db_url(self) -> str:
        """DATABASE_URL with asyncpg prepared-statement cache disabled.

        Supabase uses PgBouncer in transaction-pooling mode which does not
        support asyncpg prepared statements. The only reliable fix is to embed
        prepared_statement_cache_size=0 in the connection URL so asyncpg
        disables its cache before SQLAlchemy's own on_connect codec setup runs.
        """
        url = self.DATABASE_URL
        sep = "&" if "?" in url else "?"
        if "prepared_statement_cache_size" not in url:
            url = f"{url}{sep}prepared_statement_cache_size=0"
        return url

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

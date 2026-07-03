"""
security.py — Auth, JWT, RBAC, rate limiting for Sarwagya
Uses Supabase JWT verification (free) — no Auth0 needed.
"""
from datetime import datetime, timedelta
from typing import Optional, Literal
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import redis.asyncio as aioredis
import logging

from app.core.config import settings
from app.core.database import get_redis

logger = logging.getLogger(__name__)

# ── Password hashing ──────────────────────────────────────────────────────

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer()

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 7

Role = Literal["admin", "analyst", "viewer"]


# ── Token models ─────────────────────────────────────────────────────────

class TokenData(BaseModel):
    user_id: str
    email: str
    role: Role = "viewer"


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


# ── JWT utilities ─────────────────────────────────────────────────────────

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str, token_type: str = "access") -> TokenData:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != token_type:
            raise credentials_exception
        user_id: str = payload.get("sub")
        email: str = payload.get("email")
        role: str = payload.get("role", "viewer")
        if user_id is None:
            raise credentials_exception
        return TokenData(user_id=user_id, email=email, role=role)
    except JWTError:
        raise credentials_exception


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ── FastAPI dependencies ──────────────────────────────────────────────────

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> TokenData:
    return verify_token(credentials.credentials)


def require_role(*roles: Role):
    """Dependency factory for RBAC."""
    async def checker(current_user: TokenData = Depends(get_current_user)) -> TokenData:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role}' not permitted. Required: {roles}",
            )
        return current_user
    return checker


# Convenience role deps
require_admin = require_role("admin")
require_analyst = require_role("admin", "analyst")
require_viewer = require_role("admin", "analyst", "viewer")


# ── Rate limiting (Redis sliding window) ─────────────────────────────────

async def check_rate_limit(request: Request, user: TokenData = Depends(get_current_user)):
    """
    Sliding window rate limit using Upstash Redis.
    Limits: 60 req/min, 1000 req/day per user.
    """
    redis: aioredis.Redis = get_redis()
    user_id = user.user_id
    now = datetime.utcnow()

    minute_key = f"rl:min:{user_id}:{now.strftime('%Y%m%d%H%M')}"
    day_key = f"rl:day:{user_id}:{now.strftime('%Y%m%d')}"

    pipe = redis.pipeline()
    pipe.incr(minute_key)
    pipe.expire(minute_key, 60)
    pipe.incr(day_key)
    pipe.expire(day_key, 86400)
    results = await pipe.execute()

    minute_count, _, day_count, _ = results

    if minute_count > settings.RATE_LIMIT_PER_MINUTE:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded: 60 requests/minute",
            headers={"Retry-After": "60"},
        )
    if day_count > settings.RATE_LIMIT_PER_DAY:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Daily rate limit exceeded: 1000 requests/day",
            headers={"Retry-After": "86400"},
        )

    return user


# ── API Key auth (for agent-to-backend calls) ─────────────────────────────

async def verify_api_key(request: Request) -> bool:
    """Simple API key check for internal agent calls."""
    api_key = request.headers.get("X-API-Key")
    if not api_key or api_key != settings.SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )
    return True


# ── Security headers middleware ────────────────────────────────────────────

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; "
        "connect-src 'self' https://api.supabase.co;"
    ),
}

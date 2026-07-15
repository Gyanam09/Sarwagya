"""
auth.py — Authentication endpoints for Sarwagya
Uses Supabase as the identity provider (free tier).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from supabase import create_client, Client
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    verify_token,
    hash_password,
    verify_password,
    get_current_user,
    TokenData,
    TokenPair,
)

router = APIRouter()

supabase: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)


# ── Schemas ───────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.post("/register", response_model=TokenPair, status_code=201)
async def register(body: RegisterRequest):
    """Register a new user via Supabase Auth."""
    try:
        res = supabase.auth.sign_up({
            "email": body.email,
            "password": body.password,
            "options": {"data": {"name": body.name, "role": "analyst"}},
        })
        if res.user is None:
            raise HTTPException(400, "Registration failed. Email may already exist.")

        user_id = res.user.id
        token_data = {"sub": user_id, "email": body.email, "role": "analyst"}
        return TokenPair(
            access_token=create_access_token(token_data),
            refresh_token=create_refresh_token(token_data),
        )
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/login", response_model=TokenPair)
async def login(body: LoginRequest):
    """Login with email/password via Supabase Auth."""
    try:
        res = supabase.auth.sign_in_with_password({
            "email": body.email,
            "password": body.password,
        })
        if res.user is None:
            raise HTTPException(401, "Invalid credentials")

        user = res.user
        role = user.user_metadata.get("role", "viewer")
        token_data = {"sub": user.id, "email": user.email, "role": role}
        return TokenPair(
            access_token=create_access_token(token_data),
            refresh_token=create_refresh_token(token_data),
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "Invalid email or password")


@router.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshRequest):
    """Get a new access token using a refresh token."""
    token_data = verify_token(body.refresh_token, token_type="refresh")
    new_data = {
        "sub": token_data.user_id,
        "email": token_data.email,
        "role": token_data.role,
    }
    return TokenPair(
        access_token=create_access_token(new_data),
        refresh_token=create_refresh_token(new_data),
    )


@router.get("/me")
async def me(current_user: TokenData = Depends(get_current_user)):
    """Get current authenticated user."""
    return {
        "user_id": current_user.user_id,
        "email": current_user.email,
        "role": current_user.role,
    }


class UpdateProfileRequest(BaseModel):
    name: str | None = None
    password: str | None = None


@router.patch("/me")
async def update_me(
    body: UpdateProfileRequest,
    current_user: TokenData = Depends(get_current_user),
):
    """Update display name or password for current user via Supabase Auth."""
    update_payload: dict = {}
    if body.name:
        update_payload["data"] = {"name": body.name}
    if body.password:
        update_payload["password"] = body.password

    if not update_payload:
        raise HTTPException(400, "Nothing to update")

    try:
        supabase.auth.admin.update_user_by_id(current_user.user_id, update_payload)
    except Exception as e:
        raise HTTPException(400, f"Update failed: {str(e)}")

    return {"message": "Profile updated", "user_id": current_user.user_id}


@router.post("/logout")
async def logout(current_user: TokenData = Depends(get_current_user)):
    """Logout — client should discard tokens."""
    # With stateless JWT, logout is client-side.
    # For stricter revocation, add token to Redis blocklist here.
    return {"message": "Logged out successfully"}

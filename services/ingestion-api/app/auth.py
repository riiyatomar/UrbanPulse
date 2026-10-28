"""
Authentication and authorization module for UrbanPulse.

Provides:
- Password hashing (bcrypt via passlib)
- JWT token creation/verification
- FastAPI dependency injection for auth + RBAC
- Reusable role/department guards

Security rules:
- JWT_SECRET_KEY is REQUIRED (no default — prevents hardcoded secrets)
- Passwords are never logged, returned, or stored in plaintext
- Role/department/user info comes from the verified token, never from client
- Inactive users are rejected even with a valid token
"""

import logging
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, Field, field_validator

from app.config import settings

logger = logging.getLogger(__name__)

# ─── Password Hashing ────────────────────────────────────────

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)


def hash_password(plain: str) -> str:
    """Hash a plaintext password using bcrypt."""
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against a bcrypt hash."""
    return pwd_context.verify(plain, hashed)


# ─── Password Strength Validation ────────────────────────────

MIN_PASSWORD_LENGTH = 8

def validate_password_strength(password: str) -> None:
    """
    Enforce minimum password requirements.

    Raises ValueError with a descriptive message if the password is too weak.
    """
    errors = []
    if len(password) < MIN_PASSWORD_LENGTH:
        errors.append(f"at least {MIN_PASSWORD_LENGTH} characters")
    if not re.search(r"[A-Z]", password):
        errors.append("at least one uppercase letter")
    if not re.search(r"[a-z]", password):
        errors.append("at least one lowercase letter")
    if not re.search(r"\d", password):
        errors.append("at least one digit")
    if errors:
        raise ValueError(f"Password must contain: {', '.join(errors)}")


# ─── Email Normalization ─────────────────────────────────────

def normalize_email(email: str) -> str:
    """Normalize email to lowercase, stripped."""
    return email.strip().lower()


# ─── JWT Token Management ────────────────────────────────────

ALGORITHM = settings.JWT_ALGORITHM
SECRET_KEY = settings.JWT_SECRET_KEY
ACCESS_TOKEN_EXPIRE_MINUTES = settings.JWT_EXPIRATION_MINUTES


def create_access_token(
    user_id: str,
    role: str,
    email: str,
    department_id: Optional[str] = None,
    name: str = "",
) -> str:
    """
    Create a signed JWT access token.

    Claims:
      sub:           user UUID
      role:          user_role enum value
      email:         normalized email
      department_id: department UUID (officers only, null otherwise)
      name:          display name
      exp:           expiration timestamp
      iat:           issued-at timestamp
      jti:           unique token identifier
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "role": role,
        "email": email,
        "department_id": str(department_id) if department_id else None,
        "name": name,
        "exp": expire,
        "iat": now,
        "jti": str(uuid4()),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """
    Decode and verify a JWT access token.

    Raises JWTError on invalid/expired/malformed tokens.
    Only HS256 algorithm is accepted.
    """
    return jwt.decode(
        token,
        SECRET_KEY,
        algorithms=[ALGORITHM],
        options={"require_exp": True, "require_iat": True, "require_sub": True},
    )


# ─── Pydantic Auth Models ────────────────────────────────────

class UserPayload(BaseModel):
    """Authenticated user identity extracted from JWT."""
    id: str
    email: str
    role: str
    department_id: Optional[str] = None
    name: str = ""


class RegisterRequest(BaseModel):
    """Citizen self-registration payload."""
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def validate_email_format(cls, v):
        v = v.strip().lower()
        if not re.match(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", v):
            raise ValueError("Invalid email format")
        return v


class LoginRequest(BaseModel):
    """Login credentials."""
    email: str = Field(..., max_length=255)
    password: str = Field(..., max_length=128)


class AdminCreateUserRequest(BaseModel):
    """Administrator user creation payload."""
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    role: str = Field(..., description="Role: department_officer or administrator")
    department_id: Optional[str] = Field(None, description="Required for department_officer")

    @field_validator("role")
    @classmethod
    def validate_role(cls, v):
        allowed = {"department_officer", "administrator"}
        if v not in allowed:
            raise ValueError(f"Role must be one of: {allowed}")
        return v

    @field_validator("email")
    @classmethod
    def validate_email_format(cls, v):
        v = v.strip().lower()
        if not re.match(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", v):
            raise ValueError("Invalid email format")
        return v


class TokenResponse(BaseModel):
    """JWT token response after login/register."""
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserResponse(BaseModel):
    """Public user representation (never includes password_hash)."""
    id: str
    name: str
    email: str
    role: str
    department_id: Optional[str] = None
    is_active: bool = True
    created_at: Optional[str] = None


# ─── Rate Limiter (in-memory, per-IP) ────────────────────────

class LoginRateLimiter:
    """Simple in-memory sliding-window rate limiter for login attempts."""

    def __init__(self, max_attempts: int = 10, window_seconds: int = 60):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, list[float]] = defaultdict(list)

    def check(self, client_ip: str) -> None:
        """Raise 429 if rate limit exceeded."""
        now = time.time()
        cutoff = now - self.window_seconds
        # Prune old entries
        self._attempts[client_ip] = [
            t for t in self._attempts[client_ip] if t > cutoff
        ]
        if len(self._attempts[client_ip]) >= self.max_attempts:
            raise HTTPException(
                status_code=429,
                detail=f"Too many login attempts. Try again in {self.window_seconds} seconds.",
            )

    def record(self, client_ip: str) -> None:
        """Record a login attempt."""
        self._attempts[client_ip].append(time.time())


login_rate_limiter = LoginRateLimiter(
    max_attempts=settings.LOGIN_RATE_LIMIT_PER_MINUTE,
    window_seconds=60,
)


# ─── FastAPI OAuth2 Scheme ────────────────────────────────────

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


# ─── Core Auth Dependency ─────────────────────────────────────

async def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
) -> UserPayload:
    """
    Extract and validate the authenticated user from the Bearer token.

    Raises:
      401: Missing, malformed, expired, or invalid token
      403: Inactive user
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_access_token(token)
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    role = payload.get("role")
    email = payload.get("email")

    if not user_id or not role or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token claims",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Verify user is still active in DB
    from app.services.database import db_service
    db_user = db_service.get_user_by_id(user_id)
    if not db_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not db_user.get("is_active", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been deactivated",
        )

    return UserPayload(
        id=user_id,
        email=email,
        role=role,
        department_id=payload.get("department_id"),
        name=payload.get("name", ""),
    )


# ─── Role Guard Dependencies ─────────────────────────────────

def require_role(*allowed_roles: str):
    """
    Returns a FastAPI dependency that enforces role membership.

    Usage:
        @router.get("/admin-only", dependencies=[Depends(require_role("administrator"))])
    """
    async def _guard(current_user: UserPayload = Depends(get_current_user)) -> UserPayload:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions for this operation",
            )
        return current_user
    return _guard


def require_any_role(*allowed_roles: str):
    """Alias for require_role for readability."""
    return require_role(*allowed_roles)


# ─── Department Scope Guard ──────────────────────────────────

def get_department_scoped_user():
    """
    Returns a dependency that enforces department-level access control.

    - Administrators: access any department
    - Department officers: access ONLY their own department
    - Citizens: denied (403)

    The caller extracts the department_id from the path and validates.
    """
    async def _guard(current_user: UserPayload = Depends(get_current_user)) -> UserPayload:
        if current_user.role == "citizen":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Citizens cannot access department operations",
            )
        return current_user
    return _guard


def validate_department_access(current_user: UserPayload, path_department_id: str) -> None:
    """
    Validate that the authenticated user has access to the specified department.

    - Admin: always allowed
    - Officer: must match their department_id
    - Citizen: always denied

    Raises HTTPException(403) on unauthorized access.
    """
    if current_user.role == "citizen":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Citizens cannot access department operations",
        )
    if current_user.role == "department_officer":
        if current_user.department_id != str(path_department_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: you can only access your own department",
            )

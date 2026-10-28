"""
Authentication routes for UrbanPulse.

POST /auth/register   — Citizen self-registration (public)
POST /auth/login      — Login and receive JWT (public)
GET  /auth/me         — Current user profile (authenticated)
GET  /auth/users      — List all users (admin only)
POST /auth/users      — Create officer/admin user (admin only)
PATCH /auth/users/{id}/deactivate — Deactivate user (admin only)

Security:
- Passwords are hashed with bcrypt before storage
- JWT tokens are signed with HS256 using env-configured secret
- Registration is restricted to citizen role
- Admin/officer accounts are created only by administrators
- Rate limiting on login endpoint
- Never log passwords, hashes, or tokens
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.auth import (
    AdminCreateUserRequest,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserPayload,
    UserResponse,
    create_access_token,
    get_current_user,
    hash_password,
    login_rate_limiter,
    normalize_email,
    require_role,
    validate_password_strength,
    verify_password,
)
from app.services.database import db_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=201,
    summary="Register a new citizen account",
    description="Public endpoint for citizen self-registration. Returns JWT token on success.",
)
async def register(req: RegisterRequest):
    """
    Register a new citizen account.

    - Normalizes email to lowercase
    - Validates password strength
    - Prevents duplicate registrations
    - Returns JWT immediately after creation
    """
    email = normalize_email(req.email)

    # Validate password strength
    try:
        validate_password_strength(req.password)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Hash password
    pw_hash = hash_password(req.password)

    # Create user (citizen role only — never allow self-registration as admin/officer)
    try:
        user = db_service.create_user(
            name=req.name.strip(),
            email=email,
            password_hash=pw_hash,
            role="citizen",
            department_id=None,
        )
    except ValueError as e:
        if "already exists" in str(e).lower():
            raise HTTPException(status_code=409, detail="A user with this email already exists")
        raise HTTPException(status_code=422, detail=str(e))

    # Issue JWT
    token = create_access_token(
        user_id=user["id"],
        role=user["role"],
        email=user["email"],
        name=user["name"],
    )

    logger.info(f"New citizen registered: {user['email']}")

    return TokenResponse(
        access_token=token,
        user={
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "role": user["role"],
        },
    )


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Authenticate and receive JWT token",
    description="Returns a signed JWT bearer token for valid credentials.",
)
async def login(req: LoginRequest, request: Request):
    """
    Authenticate with email + password and receive a JWT token.

    Rate-limited to prevent brute-force attacks.
    """
    client_ip = request.client.host if request.client else "unknown"

    # Rate limit check
    login_rate_limiter.check(client_ip)
    login_rate_limiter.record(client_ip)

    email = normalize_email(req.email)

    user = db_service.get_user_by_email(email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.get("is_active", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been deactivated",
        )

    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # Issue JWT
    token = create_access_token(
        user_id=user["id"],
        role=user["role"],
        email=user["email"],
        department_id=user.get("department_id"),
        name=user["name"],
    )

    logger.info(f"User logged in: {user['email']} (role: {user['role']})")

    return TokenResponse(
        access_token=token,
        user={
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "role": user["role"],
            "department_id": user.get("department_id"),
        },
    )


@router.get(
    "/me",
    response_model=UserResponse,
    summary="Get current user profile",
    description="Returns the authenticated user's profile information.",
)
async def get_me(current_user: UserPayload = Depends(get_current_user)):
    """Return the current authenticated user's profile."""
    user = db_service.get_user_by_id(current_user.id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse(**user)


@router.get(
    "/users",
    response_model=list[UserResponse],
    summary="List all users (admin only)",
    description="Returns all registered users. Requires administrator role.",
)
async def list_users(
    current_user: UserPayload = Depends(require_role("administrator")),
):
    """List all users. Admin-only endpoint."""
    users = db_service.list_users()
    return [UserResponse(**u) for u in users]


@router.post(
    "/users",
    response_model=UserResponse,
    status_code=201,
    summary="Create officer or admin user (admin only)",
    description="Creates a department_officer or administrator account. Requires administrator role.",
)
async def admin_create_user(
    req: AdminCreateUserRequest,
    current_user: UserPayload = Depends(require_role("administrator")),
):
    """
    Create a department officer or administrator account.

    Only administrators can create non-citizen accounts.
    Officers require a valid department_id.
    """
    email = normalize_email(req.email)

    # Validate password strength
    try:
        validate_password_strength(req.password)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Validate department_id for officers
    if req.role == "department_officer":
        if not req.department_id:
            raise HTTPException(
                status_code=422,
                detail="department_id is required for department_officer role",
            )
        dept = db_service.get_department_by_id(req.department_id)
        if not dept:
            raise HTTPException(status_code=422, detail="Department not found")

    pw_hash = hash_password(req.password)

    try:
        user = db_service.create_user(
            name=req.name.strip(),
            email=email,
            password_hash=pw_hash,
            role=req.role,
            department_id=req.department_id if req.role == "department_officer" else None,
        )
    except ValueError as e:
        if "already exists" in str(e).lower():
            raise HTTPException(status_code=409, detail="A user with this email already exists")
        raise HTTPException(status_code=422, detail=str(e))

    logger.info(f"Admin {current_user.email} created user: {email} (role: {req.role})")

    return UserResponse(**user)


@router.patch(
    "/users/{user_id}/deactivate",
    summary="Deactivate a user account (admin only)",
    description="Deactivates a user account, preventing login. Requires administrator role.",
)
async def deactivate_user(
    user_id: UUID,
    current_user: UserPayload = Depends(require_role("administrator")),
):
    """Deactivate a user account. Admin-only."""
    if str(user_id) == current_user.id:
        raise HTTPException(
            status_code=422,
            detail="Cannot deactivate your own account",
        )

    success = db_service.deactivate_user(str(user_id))
    if not success:
        raise HTTPException(status_code=404, detail="User not found or already deactivated")

    logger.info(f"Admin {current_user.email} deactivated user: {user_id}")

    return {"success": True, "id": str(user_id), "message": "User deactivated"}

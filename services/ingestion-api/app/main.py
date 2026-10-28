"""
FastAPI application factory with lifespan management.

Initializes and tears down:
- Database connection pool
- S3 storage client
- Redis queue publisher
- Bootstrap admin user (from env vars, first startup only)

Mounts complaint routes under /api/v1.
Mounts auth routes under /api/v1/auth.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.models import HealthResponse
from app.routes.complaints import router as complaints_router
from app.routes.auth import router as auth_router

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(name)-25s | %(levelname)-7s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def _bootstrap_admin():
    """
    Create the initial administrator account from environment variables.
    Only runs if BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are set
    and no administrator account exists yet.
    """
    if not settings.BOOTSTRAP_ADMIN_EMAIL or not settings.BOOTSTRAP_ADMIN_PASSWORD:
        return

    from app.auth import hash_password, validate_password_strength
    from app.services.database import db_service

    try:
        validate_password_strength(settings.BOOTSTRAP_ADMIN_PASSWORD)
    except ValueError as e:
        logger.error(f"Bootstrap admin password too weak: {e}")
        return

    pw_hash = hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD)
    result = db_service.bootstrap_admin(
        name=settings.BOOTSTRAP_ADMIN_NAME,
        email=settings.BOOTSTRAP_ADMIN_EMAIL,
        password_hash=pw_hash,
    )
    if result:
        logger.info(f"Bootstrap administrator created: {result['email']}")
    else:
        logger.info("Bootstrap admin skipped (admin already exists or email taken)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.

    Startup: connect to DB, S3, and Redis. Bootstrap admin if configured.
    Shutdown: close all connections gracefully.
    """
    # --- Startup ---
    logger.info("Starting ingestion-api...")

    from app.services.database import db_service
    from app.services.storage import storage_service
    from app.services.queue import queue_publisher

    try:
        db_service.connect()
        logger.info("Database connected")
    except Exception as e:
        logger.error(f"Database connection failed: {e}")

    try:
        storage_service.connect()
        logger.info("Storage service connected")
    except Exception as e:
        logger.error(f"Storage connection failed: {e}")

    try:
        queue_publisher.connect()
        logger.info("Queue publisher connected")
    except Exception as e:
        logger.error(f"Queue connection failed: {e}")

    # Bootstrap admin from env (first startup only)
    try:
        _bootstrap_admin()
    except Exception as e:
        logger.warning(f"Bootstrap admin creation failed: {e}")

    logger.info("Ingestion API ready")

    yield

    # --- Shutdown ---
    logger.info("Shutting down ingestion-api...")
    db_service.disconnect()
    queue_publisher.disconnect()
    logger.info("Ingestion API stopped")


# Create the FastAPI application
app = FastAPI(
    title="UrbanPulse Ingestion API",
    description=(
        "Receives civic infrastructure complaint images, applies privacy "
        "blurring, stores to S3, and queues detection jobs. Part of the "
        "UrbanPulse computer-vision civic issue tracking system. "
        "Secured with JWT bearer authentication and RBAC."
    ),
    version="2.0.0",
    lifespan=lifespan,
)

# Mount routes
app.include_router(complaints_router)
app.include_router(auth_router)

# CORS — configured via environment variable, not hardcoded
cors_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse, tags=["system"])
async def health_check():
    """Service health check endpoint. No authentication required."""
    return HealthResponse()

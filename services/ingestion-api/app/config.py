"""
Application configuration via environment variables.

Uses pydantic-settings for type-safe config with defaults suitable for local dev.
All settings can be overridden via environment variables or a .env file.
"""

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Ingestion API configuration."""

    # --- Database ---
    DATABASE_URL: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/urbanpulse",
        description="PostgreSQL connection string",
    )
    DB_POOL_MIN: int = Field(default=2, description="Minimum DB pool connections")
    DB_POOL_MAX: int = Field(default=10, description="Maximum DB pool connections")

    # --- S3 / MinIO ---
    S3_ENDPOINT: str = Field(
        default="http://localhost:9000", description="S3-compatible endpoint URL"
    )
    S3_BUCKET: str = Field(
        default="urbanpulse-images", description="Image storage bucket name"
    )
    S3_ACCESS_KEY: str = Field(default="minioadmin", description="S3 access key")
    S3_SECRET_KEY: str = Field(default="minioadmin", description="S3 secret key")
    S3_REGION: str = Field(default="us-east-1", description="S3 region")

    # --- Redis Queue ---
    REDIS_URL: str = Field(
        default="redis://localhost:6379/0", description="Redis connection URL"
    )
    QUEUE_NAME: str = Field(
        default="detection_jobs", description="Queue name for detection jobs"
    )

    # --- Image Processing ---
    MAX_IMAGE_SIZE_MB: int = Field(default=20, description="Max upload size in MB")
    ALLOWED_CONTENT_TYPES: list[str] = Field(
        default=["image/jpeg", "image/png", "image/webp", "image/tiff"],
        description="Accepted image MIME types",
    )

    # --- Blur Pipeline ---
    BLUR_ENABLED: bool = Field(
        default=True, description="Enable face/plate blurring"
    )
    BLUR_MODE: str = Field(
        default="stub",
        description="Blur mode: 'model' (production) or 'stub' (dev/testing)",
    )
    FACE_MODEL_PATH: str = Field(
        default="yolov8n-face.pt",
        description="Path to face detection YOLO weights",
    )
    PLATE_MODEL_PATH: str = Field(
        default="yolov8n-plate.pt",
        description="Path to license plate detection YOLO weights",
    )

    # --- Detection ---
    CONFIDENCE_THRESHOLD: float = Field(
        default=0.4,
        description="Detections below this confidence go to human review queue",
    )

    # --- Authentication ---
    JWT_SECRET_KEY: str = Field(
        ...,
        description="JWT signing secret (REQUIRED — no default, must be set via env)",
    )
    JWT_EXPIRATION_MINUTES: int = Field(
        default=480, description="Access token expiry in minutes (default: 8 hours)"
    )
    JWT_ALGORITHM: str = Field(
        default="HS256", description="JWT signing algorithm"
    )

    # --- CORS ---
    CORS_ORIGINS: str = Field(
        default="http://localhost:5173,http://localhost:8080,http://localhost:8081,http://localhost:8082,http://localhost:8083,http://localhost:8084,http://localhost:19006,http://127.0.0.1:5173,http://127.0.0.1:8080,http://127.0.0.1:8081,http://127.0.0.1:8082,http://127.0.0.1:8083,http://127.0.0.1:8084,http://127.0.0.1:19006",
        description="Comma-separated allowed CORS origins",
    )


    # --- Rate Limiting ---
    LOGIN_RATE_LIMIT_PER_MINUTE: int = Field(
        default=10, description="Max login attempts per IP per minute"
    )

    # --- Bootstrap Admin ---
    BOOTSTRAP_ADMIN_EMAIL: str = Field(
        default="", description="Bootstrap admin email (created on first startup if set)"
    )
    BOOTSTRAP_ADMIN_PASSWORD: str = Field(
        default="", description="Bootstrap admin password (hashed on first use, never stored raw)"
    )
    BOOTSTRAP_ADMIN_NAME: str = Field(
        default="System Administrator", description="Bootstrap admin display name"
    )

    # --- Server ---
    HOST: str = Field(default="0.0.0.0", description="Server bind host")
    PORT: int = Field(default=8001, description="Server bind port")
    DEBUG: bool = Field(default=False, description="Enable debug mode")

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


# Singleton settings instance
settings = Settings()

"""
Configuration settings for the deduplication service.
"""

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Dedup service settings."""

    # --- Mode Configuration ---
    EMBEDDING_MODE: str = Field(
        default="stub",
        description="Mode: 'stub' (dev/testing with deterministic embeddings) or 'model' (production CLIP)",
    )
    CLIP_MODEL_NAME: str = Field(
        default="clip-ViT-B-32",
        description="CLIP model variant to use if EMBEDDING_MODE='model'",
    )

    # --- Dedup Criteria ---
    SIMILARITY_THRESHOLD: float = Field(
        default=0.92,
        description="Cosine similarity threshold to classify a complaint as duplicate",
    )
    SEARCH_RADIUS_METERS: float = Field(
        default=500.0,
        description="Geographic search radius for duplicates in meters",
    )
    TIME_WINDOW_DAYS: int = Field(
        default=30,
        description="Search window in days to consider potential duplicate complaints",
    )
    GEOHASH_PRECISION: int = Field(
        default=7,
        description="Precision for geohash index (7 yields ~153m x 153m grid cells)",
    )

    # --- Database & Queue ---
    DATABASE_URL: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/urbanpulse",
        description="PostgreSQL connection string",
    )
    REDIS_URL: str = Field(
        default="redis://localhost:6379/0",
        description="Redis connection URL",
    )
    INPUT_QUEUE: str = Field(
        default="dedup_jobs",
        description="Queue to pull dedup check jobs from",
    )
    OUTPUT_QUEUE: str = Field(
        default="scoring_jobs",
        description="Queue to publish scoring jobs to for unique complaints",
    )

    # --- S3 Configuration ---
    S3_ENDPOINT: str = Field(default="http://localhost:9000")
    S3_ACCESS_KEY: str = Field(default="minioadmin")
    S3_SECRET_KEY: str = Field(default="minioadmin")
    S3_REGION: str = Field(default="us-east-1")

    # --- Worker poll ---
    WORKER_POLL_TIMEOUT: int = Field(default=5)

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()

"""
Core duplicate detection service.
Combines geohashing, CLIP embedding generation, and vector search.
"""

import logging
from typing import Optional, Tuple
from uuid import UUID

from app.config import settings
from app.services.embedding import embedding_service
from app.services.geohash import encode_geohash
from app.services.vector_store import vector_store
from app.services.database import dedup_db

logger = logging.getLogger(__name__)


class DedupService:
    """Orchestrates CLIP embedding extraction and vector DB lookups."""

    def check_duplicate(
        self,
        complaint_id: str,
        image_bytes: bytes,
        lat: float,
        lng: float,
        embedding: Optional[list[float]] = None,
    ) -> Tuple[bool, Optional[str], float]:
        """
        Check if a complaint has a duplicate within the radius and time window.

        Returns:
            Tuple of (is_duplicate, matched_complaint_id, similarity_score)
        """
        # 1. Compute embedding if not provided
        if embedding is None:
            embedding = embedding_service.compute_embedding(image_bytes)

        # 2. Query nearest neighbors in vector store
        neighbors = vector_store.find_nearest_neighbors(
            embedding=embedding,
            lat=lat,
            lng=lng,
            radius_meters=settings.SEARCH_RADIUS_METERS,
            time_window_days=settings.TIME_WINDOW_DAYS,
            exclude_id=complaint_id,
        )

        # 3. Check if any matches exceed similarity threshold
        for match in neighbors:
            similarity = match["similarity"]
            # Exclude already rejected/closed complaints if needed, but standard is to match any open/assigned/etc.
            if similarity >= settings.SIMILARITY_THRESHOLD:
                matched_id = str(match["complaint_id"])
                logger.info(
                    f"Duplicate found for {complaint_id}: matched with {matched_id} "
                    f"(similarity {similarity:.4f})"
                )
                return True, matched_id, similarity

        # No duplicates found
        return False, None, 0.0

    def process_complaint_dedup(
        self,
        complaint_id: str,
        image_bytes: bytes,
        lat: float,
        lng: float,
    ) -> bool:
        """
        Executes duplicate detection lifecycle.
        - Computes embedding once
        - Checks for duplicates
        - If duplicate, updates status to 'rejected'
        - If unique, saves the computed embedding and geohash (no redundant inference)
        """
        embedding = embedding_service.compute_embedding(image_bytes)

        is_duplicate, matched_id, score = self.check_duplicate(
            complaint_id, image_bytes, lat, lng, embedding=embedding
        )

        geohash = encode_geohash(lat, lng, settings.GEOHASH_PRECISION)

        if is_duplicate:
            # Mark complaint as rejected with reference to original complaint
            dedup_db.reject_as_duplicate(complaint_id, duplicate_of_id=matched_id)
            return True
        else:
            # Not a duplicate, reuse the already computed embedding
            dedup_db.insert_embedding(complaint_id, embedding, geohash)
            return False


dedup_service = DedupService()

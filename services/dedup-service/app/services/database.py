"""
Database operations for the deduplication service.
Handles pool setup, complaint status updates, and embedding storage.
"""

import logging
from contextlib import contextmanager
from typing import Optional, List
from uuid import UUID

import psycopg2
from psycopg2 import pool, extras

from app.config import settings

logger = logging.getLogger(__name__)

psycopg2.extras.register_uuid()


class DedupDB:
    """Manages database connection pool and CRUD actions for deduplication."""

    def __init__(self):
        self._pool: Optional[pool.ThreadedConnectionPool] = None

    def connect(self):
        """Initialize the connection pool."""
        self._pool = pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=10,
            dsn=settings.DATABASE_URL,
        )
        logger.info("Deduplication DB pool initialized")

    def disconnect(self):
        """Close pool connections."""
        if self._pool:
            self._pool.closeall()
            logger.info("Deduplication DB pool closed")

    @contextmanager
    def get_connection(self):
        """Get connection context manager."""
        conn = self._pool.getconn()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            self._pool.putconn(conn)

    def insert_embedding(self, complaint_id: str, embedding: List[float], geohash: str):
        """
        Store a complaint's vector embedding.
        """
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                # pgvector requires the vector representation format: [val, val, ...]
                # psycopg2 handles lists as arrays, but pgvector expects brackets for casts
                embedding_str = "[" + ",".join(map(str, embedding)) + "]"
                cur.execute(
                    """
                    INSERT INTO complaint_embeddings (complaint_id, embedding, geohash)
                    VALUES (%s::uuid, %s::vector, %s)
                    ON CONFLICT (complaint_id) DO UPDATE
                    SET embedding = EXCLUDED.embedding, geohash = EXCLUDED.geohash
                    """,
                    (complaint_id, embedding_str, geohash),
                )
                logger.info(f"Stored embedding for complaint {complaint_id}")

    def reject_as_duplicate(self, complaint_id: str, duplicate_of_id: Optional[str] = None):
        """
        Mark a complaint as rejected since it's a duplicate.
        """
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                if duplicate_of_id:
                    cur.execute(
                        """
                        UPDATE complaints
                        SET status = 'rejected'::complaint_status,
                            duplicate_of_id = %s::uuid,
                            closed_at = NOW(),
                            updated_at = NOW()
                        WHERE id = %s::uuid
                        """,
                        (duplicate_of_id, complaint_id),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE complaints
                        SET status = 'rejected'::complaint_status,
                            closed_at = NOW(),
                            updated_at = NOW()
                        WHERE id = %s::uuid
                        """,
                        (complaint_id,),
                    )
                logger.info(f"Rejected duplicate complaint {complaint_id} (duplicate_of={duplicate_of_id})")

    def get_complaint_location(self, complaint_id: str) -> Optional[dict]:
        """Get complaint coordinates, date, issue class, and status."""
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT lat, lng, created_at, issue_class, confidence, status
                    FROM complaints WHERE id = %s::uuid
                    """,
                    (complaint_id,),
                )
                row = cur.fetchone()
                if row:
                    return {
                        "lat": row[0],
                        "lng": row[1],
                        "created_at": row[2],
                        "issue_class": row[3],
                        "confidence": float(row[4]) if row[4] is not None else 0.0,
                        "status": row[5],
                    }
                return None


dedup_db = DedupDB()

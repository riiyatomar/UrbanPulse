"""
Database service for updating complaints with detection results.

Updates the complaints row with the detected issue_class, confidence,
and status after model inference.
"""

import logging
from contextlib import contextmanager
from typing import Optional

import psycopg2
from psycopg2 import pool, extras

from app.config import settings

logger = logging.getLogger(__name__)

psycopg2.extras.register_uuid()


class DetectionDB:
    """Database operations for the detection service."""

    def __init__(self):
        self._pool: Optional[pool.ThreadedConnectionPool] = None

    def connect(self):
        """Initialize the connection pool."""
        self._pool = pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=10,
            dsn=settings.DATABASE_URL,
        )
        logger.info("Detection DB pool initialized")

    def disconnect(self):
        """Close all connections."""
        if self._pool:
            self._pool.closeall()

    @contextmanager
    def get_connection(self):
        """Get a connection from the pool."""
        conn = self._pool.getconn()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            self._pool.putconn(conn)

    def update_detection(
        self,
        complaint_id: str,
        issue_class: str,
        confidence: float,
        status: str,
    ):
        """
        Update a complaint with detection results.

        Args:
            complaint_id: UUID of the complaint
            issue_class: Detected issue type (one of 11 classes)
            confidence: Model confidence score [0, 1]
            status: New status ('assigned' or 'under_review')
        """
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE complaints
                    SET issue_class = %s::issue_class,
                        confidence = %s,
                        status = %s::complaint_status,
                        updated_at = NOW()
                    WHERE id = %s::uuid
                    """,
                    (issue_class, confidence, status, complaint_id),
                )
                if cur.rowcount == 0:
                    logger.warning(f"No complaint found with ID {complaint_id}")
                else:
                    logger.info(
                        f"Updated complaint {complaint_id}: "
                        f"class={issue_class}, conf={confidence:.3f}, status={status}"
                    )

    def update_status(
        self,
        complaint_id: str,
        status: str,
        confidence: Optional[float] = None,
    ):
        """
        Update complaint status and optionally confidence without altering issue_class.

        Used when model detection is inconclusive, fails, or requires human review,
        preserving the original or default issue_class.
        """
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                if confidence is not None:
                    cur.execute(
                        """
                        UPDATE complaints
                        SET status = %s::complaint_status,
                            confidence = %s,
                            updated_at = NOW()
                        WHERE id = %s::uuid
                        """,
                        (status, confidence, complaint_id),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE complaints
                        SET status = %s::complaint_status,
                            updated_at = NOW()
                        WHERE id = %s::uuid
                        """,
                        (status, complaint_id),
                    )
                if cur.rowcount == 0:
                    logger.warning(f"No complaint found with ID {complaint_id}")
                else:
                    logger.info(
                        f"Updated complaint {complaint_id} status to {status}"
                    )

    def get_complaint(self, complaint_id: str) -> Optional[dict]:
        """Fetch a complaint by ID (for verification/logging)."""
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, image_url, lat, lng, issue_class,
                           confidence, status, created_at
                    FROM complaints WHERE id = %s::uuid
                    """,
                    (complaint_id,),
                )
                row = cur.fetchone()
                if row is None:
                    return None
                return {
                    "id": row[0],
                    "image_url": row[1],
                    "lat": row[2],
                    "lng": row[3],
                    "issue_class": row[4],
                    "confidence": row[5],
                    "status": row[6],
                    "created_at": row[7],
                }


detection_db = DetectionDB()

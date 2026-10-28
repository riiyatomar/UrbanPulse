"""
Redis queue interface for consuming deduplication tasks.
"""

import json
import logging
from typing import Optional, Dict, Any

import redis

from app.config import settings

logger = logging.getLogger(__name__)


class DedupQueue:
    """Consumes tasks from the deduplication queue."""

    def __init__(self):
        self._redis: Optional[redis.Redis] = None

    def connect(self):
        """Connect to Redis server."""
        self._redis = redis.from_url(
    settings.REDIS_URL,
    decode_responses=True,
    socket_connect_timeout=5,
    socket_timeout=settings.WORKER_POLL_TIMEOUT + 5,
)
        self._redis.ping()
        logger.info(f"Deduplication queue connected to {settings.REDIS_URL}")

    def disconnect(self):
        """Close connection."""
        if self._redis:
            self._redis.close()

    def consume_job(self, timeout: int = 5) -> Optional[Dict[str, Any]]:
        """
        Pulls a job from the input queue (blocking pop).
        """
        try:
            res = self._redis.brpop(settings.INPUT_QUEUE, timeout=timeout)
            if res is None:
                return None
            _, msg = res
            job = json.loads(msg)
            logger.debug(f"Consumed dedup job: {job.get('complaint_id')}")
            return job
        except Exception as e:
            logger.error(f"Failed to consume dedup job: {e}")
            return None

    def publish_scoring_job(
        self,
        complaint_id: str,
        issue_class: str,
        confidence: float,
        mask_area: Optional[float] = None,
    ):
        """
        Publish a scoring job for a verified unique complaint.
        Duplicates do not call this method.
        """
        payload = {
            "complaint_id": complaint_id,
            "issue_class": issue_class,
            "confidence": confidence,
            "job_type": "scoring",
        }
        if mask_area is not None:
            payload["mask_area"] = mask_area

        message = json.dumps(payload)
        self._redis.lpush(settings.OUTPUT_QUEUE, message)
        logger.info(f"Published scoring job for unique complaint {complaint_id} to {settings.OUTPUT_QUEUE}")


dedup_queue = DedupQueue()

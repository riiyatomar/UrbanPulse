"""
Redis queue consumer and publisher for the detection service.

Consumes detection jobs from the ingestion-api and publishes
results to scoring and dedup queues for downstream processing.
"""

import json
import logging
from typing import Optional

import redis

from app.config import settings

logger = logging.getLogger(__name__)


class DetectionQueue:
    """Redis-based queue consumer and publisher."""

    def __init__(self):
        self._redis: Optional[redis.Redis] = None

    def connect(self):
        """Initialize the Redis connection."""
        self._redis = redis.from_url(
    settings.REDIS_URL,
    decode_responses=True,
    socket_connect_timeout=5,
    socket_timeout=settings.WORKER_POLL_TIMEOUT + 5,
)
        self._redis.ping()
        logger.info(f"Detection queue connected to {settings.REDIS_URL}")

    def disconnect(self):
        """Close the Redis connection."""
        if self._redis:
            self._redis.close()

    def consume_detection_job(self, timeout: int = 5) -> Optional[dict]:
        """
        Consume a detection job from the input queue (blocking pop).

        Args:
            timeout: BRPOP timeout in seconds

        Returns:
            Parsed job dict {complaint_id, image_url} or None if timeout
        """
        try:
            result = self._redis.brpop(settings.INPUT_QUEUE, timeout=timeout)
            if result is None:
                return None

            _, message = result
            job = json.loads(message)
            logger.debug(f"Consumed detection job: {job.get('complaint_id', 'unknown')}")
            return job

        except Exception as e:
            logger.error(f"Failed to consume job: {e}")
            return None

    def publish_scoring_job(self, complaint_id: str, issue_class: str, confidence: float):
        """Publish a scoring job after detection."""
        message = json.dumps({
            "complaint_id": complaint_id,
            "issue_class": issue_class,
            "confidence": confidence,
            "job_type": "scoring",
        })
        self._redis.lpush(settings.OUTPUT_QUEUE, message)
        logger.debug(f"Published scoring job for {complaint_id}")

    def publish_dedup_job(
        self,
        complaint_id: str,
        image_url: str,
        issue_class: Optional[str] = None,
        confidence: Optional[float] = None,
        mask_area: Optional[float] = None,
    ):
        """Publish a dedup job after detection with detection context."""
        payload = {
            "complaint_id": complaint_id,
            "image_url": image_url,
            "job_type": "dedup",
        }
        if issue_class is not None:
            payload["issue_class"] = issue_class
        if confidence is not None:
            payload["confidence"] = confidence
        if mask_area is not None:
            payload["mask_area"] = mask_area
        message = json.dumps(payload)
        self._redis.lpush(settings.DEDUP_QUEUE, message)
        logger.debug(f"Published dedup job for {complaint_id}")


detection_queue = DetectionQueue()

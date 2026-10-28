"""
Redis queue publisher for detection jobs.

Publishes complaint detection tasks to a Redis queue that the
detection-service consumes. Uses a simple Redis list-based queue
for dev, abstracted behind a publisher interface for production
swap to RabbitMQ/Kafka.
"""

import json
import logging
from typing import Optional

import redis

from app.config import settings

logger = logging.getLogger(__name__)


class QueuePublisher:
    """Publishes detection jobs to a Redis queue."""

    def __init__(self):
        self._redis: Optional[redis.Redis] = None

    def connect(self):
        """Initialize the Redis connection."""
        try:
            self._redis = redis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=3,
                socket_timeout=5,
            )
            # Verify connection
            self._redis.ping()
            logger.info(f"Queue publisher connected to {settings.REDIS_URL}")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise

    def disconnect(self):
        """Close the Redis connection."""
        if self._redis:
            self._redis.close()
            logger.info("Queue publisher disconnected")

    def publish_detection_job(self, complaint_id: str, image_url: str) -> bool:
        """
        Publish a detection job to the queue.

        The detection-service will consume this and run YOLOv8 +
        segmentation inference on the image.

        Args:
            complaint_id: UUID of the complaint
            image_url: S3 URL of the original image

        Returns:
            True if published successfully
        """
        message = json.dumps(
            {
                "complaint_id": complaint_id,
                "image_url": image_url,
                "job_type": "detection",
            }
        )

        try:
            self._redis.lpush(settings.QUEUE_NAME, message)
            logger.info(
                f"Published detection job for complaint {complaint_id}"
            )
            return True
        except Exception as e:
            logger.error(f"Failed to publish detection job: {e}")
            return False

    def get_queue_length(self) -> int:
        """Get the current number of jobs in the queue."""
        return self._redis.llen(settings.QUEUE_NAME) if self._redis else 0


# Singleton instance
queue_publisher = QueuePublisher()

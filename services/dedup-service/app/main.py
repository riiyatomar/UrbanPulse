"""
Main entry point for duplicate detection worker.
"""

import logging
import signal
import sys
import boto3
from botocore.config import Config

from app.config import settings
from app.services.database import dedup_db
from app.services.queue import dedup_queue
from app.services.dedup import dedup_service
from app.services.embedding import embedding_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)-25s | %(levelname)-7s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

_shutdown = False


def signal_handler(signum, frame):
    global _shutdown
    logger.info("Shutdown signal received, shutting down gracefully...")
    _shutdown = True


def download_image(image_url: str) -> bytes:
    """Download the original image from S3 storage."""
    s3_client = boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
        config=Config(signature_version="s3v4"),
    )

    parts = image_url.replace(settings.S3_ENDPOINT + "/", "").split("/", 1)
    bucket = parts[0]
    key = parts[1] if len(parts) > 1 else ""

    response = s3_client.get_object(Bucket=bucket, Key=key)
    return response["Body"].read()


def process_job(job: dict):
    """
    Process a single deduplication job:
    1. Validate job payload.
    2. Fetch complaint location and metadata from database.
    3. Download image from S3.
    4. Run dedup check and status updates.
    5. If unique, publish downstream scoring job.
       If duplicate, reject and SKIP scoring.
    """
    if not isinstance(job, dict) or "complaint_id" not in job:
        logger.error(f"Malformed deduplication job message: {job}")
        return

    complaint_id = job["complaint_id"]
    image_url = job.get("image_url")
    if not image_url:
        logger.error(f"Missing image_url in dedup job for {complaint_id}")
        return

    # 1. Fetch location & metadata from database
    location = dedup_db.get_complaint_location(complaint_id)
    if not location:
        logger.error(f"Complaint {complaint_id} not found in database. Skipping.")
        return

    # If already rejected, skip
    if location.get("status") == "rejected":
        logger.info(f"Complaint {complaint_id} is already rejected. Skipping dedup.")
        return

    lat = location["lat"]
    lng = location["lng"]

    # 2. Download original image
    try:
        image_bytes = download_image(image_url)
        if not image_bytes:
            raise ValueError("Empty image bytes downloaded")
    except Exception as e:
        logger.error(f"Failed to download image for dedup check on {complaint_id}: {e}")
        return

    # 3. Check for duplicates and resolve
    try:
        is_duplicate = dedup_service.process_complaint_dedup(
            complaint_id, image_bytes, lat, lng
        )
    except Exception as e:
        logger.error(f"Failed dedup processing for {complaint_id}: {e}", exc_info=True)
        return

    if is_duplicate:
        logger.info(f"Resolved duplicate complaint {complaint_id} -> status: REJECTED (scoring SKIPPED)")
    else:
        logger.info(f"Complaint {complaint_id} is UNIQUE -> embedding and geohash stored")
        # Step 5: Publish scoring job for unique complaints
        issue_class = job.get("issue_class") or location.get("issue_class")
        confidence = job.get("confidence") if job.get("confidence") is not None else location.get("confidence", 0.0)
        mask_area = job.get("mask_area")

        if issue_class:
            dedup_queue.publish_scoring_job(
                complaint_id=complaint_id,
                issue_class=issue_class,
                confidence=confidence,
                mask_area=mask_area,
            )
        else:
            logger.warning(f"No issue_class found for complaint {complaint_id}; skipping scoring publish")


def main():
    """Main worker startup."""
    logger.info("Starting duplicate detection service...")

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Initialize connections
    dedup_db.connect()
    dedup_queue.connect()

    # Load embedding models (stub or CLIP)
    if not embedding_service.load_model():
        logger.error("Failed to load embedding service. Exiting.")
        sys.exit(1)

    logger.info(f"Consuming deduplication jobs from queue: {settings.INPUT_QUEUE}")

    try:
        while not _shutdown:
            job = dedup_queue.consume_job(timeout=settings.WORKER_POLL_TIMEOUT)
            if job is None:
                continue

            try:
                process_job(job)
            except Exception as e:
                logger.error(f"Failed to process dedup job: {e}", exc_info=True)

    finally:
        logger.info("Shutting down duplicate detection service worker...")
        dedup_db.disconnect()
        dedup_queue.disconnect()
        logger.info("Duplicate detection worker stopped.")


if __name__ == "__main__":
    main()

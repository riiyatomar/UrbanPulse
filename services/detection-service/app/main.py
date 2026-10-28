"""
Detection service worker — main entry point.

Continuously consumes detection jobs from the Redis queue, runs
YOLOv8 + segmentation inference (or stub in dev mode), updates
the complaint in the database, and publishes downstream jobs.

Usage:
    python -m app.main
"""

import io
import logging
import signal
import sys

import boto3
from botocore.config import Config

from app.config import settings
from app.models.base import DetectionResult
from app.services.database import detection_db
from app.services.queue import detection_queue

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)-25s | %(levelname)-7s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Graceful shutdown flag
_shutdown = False


def signal_handler(signum, frame):
    global _shutdown
    logger.info(f"Received signal {signum}, shutting down...")
    _shutdown = True


def create_detectors():
    """Create detector instances based on configuration."""
    mode = settings.MODEL_MODE.lower().strip()
    if mode in ("stub", "dev", "test"):
        from app.models.stub_detector import StubDetector

        stub = StubDetector()
        stub.load()
        logger.info("Using stub detector (dev mode)")
        return [stub]

    if mode not in ("model", "production"):
        raise ValueError(
            f"Invalid MODEL_MODE '{settings.MODEL_MODE}'. Allowed modes: 'stub' or 'model'."
        )

    detectors = []

    # Load YOLOv8 detector
    from app.models.yolo_detector import YOLODetector

    yolo = YOLODetector(settings.YOLO_MODEL_PATH)
    if yolo.load():
        detectors.append(yolo)
    else:
        logger.warning(f"YOLOv8 failed to load from {settings.YOLO_MODEL_PATH}")

    # Load segmentation detector
    from app.models.segmentation import SegmentationDetector

    seg = SegmentationDetector(settings.SEG_MODEL_PATH)
    if seg.load():
        detectors.append(seg)
    else:
        logger.warning(f"Segmentation model failed to load from {settings.SEG_MODEL_PATH}")

    if not detectors:
        logger.error(
            "No models loaded in 'model' mode! Real inference weights unavailable. "
            "Incoming complaints will be routed safely to 'under_review'."
        )

    return detectors


def download_image(image_url: str) -> bytes:
    """Download image from S3-compatible storage."""
    s3_client = boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
        config=Config(signature_version="s3v4"),
    )

    # Parse bucket and key from URL
    # URL format: http://endpoint/bucket/key
    parts = image_url.replace(settings.S3_ENDPOINT + "/", "").split("/", 1)
    bucket = parts[0]
    key = parts[1] if len(parts) > 1 else ""

    response = s3_client.get_object(Bucket=bucket, Key=key)
    return response["Body"].read()


def pick_best_detection(all_detections: list[DetectionResult]) -> DetectionResult:
    """
    Select the best detection from combined model results.

    Strategy: highest confidence wins.
    """
    if not all_detections:
        return None
    return max(all_detections, key=lambda d: d.confidence)


def process_job(job: dict, detectors: list):
    """
    Process a single detection job.

    Steps:
    1. Validate job payload
    2. Download image from S3
    3. Run all detectors
    4. Pick best detection (highest confidence)
    5. Update complaint in database
    6. Publish downstream job to dedup service
    """
    if not isinstance(job, dict) or "complaint_id" not in job:
        logger.error(f"Malformed detection job message: {job}")
        return

    complaint_id = job["complaint_id"]
    image_url = job.get("image_url")
    if not image_url:
        logger.error(f"Missing image_url for complaint {complaint_id}")
        try:
            detection_db.update_status(
                complaint_id=complaint_id,
                status="under_review",
                confidence=0.0,
            )
        except Exception as db_err:
            logger.error(f"Failed to update status for {complaint_id}: {db_err}")
        return

    logger.info(f"Processing complaint {complaint_id}")

    # Step 1: Download image
    try:
        image_bytes = download_image(image_url)
        if not image_bytes:
            raise ValueError(f"Downloaded empty image bytes for {complaint_id}")
    except Exception as e:
        logger.error(f"Failed to download image for {complaint_id}: {e}")
        try:
            detection_db.update_status(
                complaint_id=complaint_id,
                status="under_review",
                confidence=0.0,
            )
        except Exception as db_err:
            logger.error(f"Failed to update status for {complaint_id}: {db_err}")
        return

    # Validate image bytes to catch corrupt images safely
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes))
        img.verify()
    except Exception as e:
        logger.error(f"Corrupt or invalid image for {complaint_id}: {e}")
        try:
            detection_db.update_status(
                complaint_id=complaint_id,
                status="under_review",
                confidence=0.0,
            )
        except Exception as db_err:
            logger.error(f"Failed to update status for {complaint_id}: {db_err}")
        return

    # Step 2: Run all detectors
    all_detections = []
    for detector in detectors:
        try:
            results = detector.detect(image_bytes)
            all_detections.extend(results)
            logger.info(
                f"{detector.model_name}: {len(results)} detections "
                f"for {complaint_id}"
            )
        except Exception as e:
            logger.error(f"{detector.model_name} failed for {complaint_id}: {e}")

    # Step 3: Pick best detection
    best = pick_best_detection(all_detections)

    if best is None or best.confidence < settings.MIN_DETECTION_THRESHOLD:
        # No valid detection exceeding minimum threshold — flag for human review
        # Preserve original/default issue_class rather than forcing a fake class
        logger.warning(
            f"No confident detection for {complaint_id} (best={best}), flagging for review"
        )
        detection_db.update_status(
            complaint_id=complaint_id,
            status="under_review",
            confidence=best.confidence if best else 0.0,
        )
        return

    # Step 4: Determine status based on confidence
    if best.confidence >= settings.CONFIDENCE_THRESHOLD:
        status = "assigned"
    else:
        status = "under_review"

    # Step 5: Update complaint in database
    detection_db.update_detection(
        complaint_id=complaint_id,
        issue_class=best.issue_class,
        confidence=best.confidence,
        status=status,
    )

    # Step 6: Publish downstream job to deduplication service
    detection_queue.publish_dedup_job(
        complaint_id=complaint_id,
        image_url=image_url,
        issue_class=best.issue_class,
        confidence=best.confidence,
        mask_area=best.mask_area,
    )

    logger.info(
        f"Completed {complaint_id}: {best.issue_class} "
        f"({best.confidence:.3f}) → {status} (queued for dedup)"
    )


def main():
    """Main worker loop."""
    logger.info("Starting detection service worker...")

    # Register signal handlers for graceful shutdown
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Initialize connections
    detection_db.connect()
    detection_queue.connect()

    # Load models
    detectors = create_detectors()
    logger.info(f"Loaded {len(detectors)} detector(s)")

    # Worker loop
    logger.info(f"Consuming from queue: {settings.INPUT_QUEUE}")
    try:
        while not _shutdown:
            job = detection_queue.consume_detection_job(
                timeout=settings.WORKER_POLL_TIMEOUT
            )
            if job is None:
                continue  # Timeout, check shutdown flag

            try:
                process_job(job, detectors)
            except Exception as e:
                logger.error(f"Job processing failed: {e}", exc_info=True)

    finally:
        logger.info("Shutting down detection service...")
        detection_db.disconnect()
        detection_queue.disconnect()
        logger.info("Detection service stopped")


if __name__ == "__main__":
    main()

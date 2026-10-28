"""
Main worker loop for the scoring service.
"""

import logging
import signal
import sys

from app.config import settings
from app.services.database import scoring_db
from app.services.queue import scoring_queue
from app.services.gis import gis_service
from app.services.engine import scoring_engine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)-25s | %(levelname)-7s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

_shutdown = False


def signal_handler(signum, frame):
    global _shutdown
    logger.info("Shutdown signal received, stopping worker...")
    _shutdown = True


def process_job(job: dict):
    """
    Process scoring:
    1. Read complaint context (coordinates) from DB.
    2. Lookup spatial metadata from mock GIS.
    3. Run engine to compute severity and priority.
    4. Save scaled scores to DB.
    """
    complaint_id = job["complaint_id"]
    issue_class = job["issue_class"]
    mask_area = job.get("mask_area")  # Segmentation area size if present

    # 1. Read coordinates
    context = scoring_db.get_complaint_context(complaint_id)
    if not context:
        logger.error(f"Complaint {complaint_id} context not found in DB. Skipping.")
        return

    # Check if complaint was rejected (e.g. marked as duplicate by dedup service)
    if context.get("status") == "rejected":
        logger.info(f"Complaint {complaint_id} is rejected (duplicate). Skipping scoring.")
        return

    lat = context["lat"]
    lng = context["lng"]

    # 2. Get GIS Location details
    gis_context = gis_service.get_location_context(lat, lng)

    # 3. Calculate scores
    scores = scoring_engine.calculate_scores(
        issue_class=issue_class,
        location_context=gis_context,
        mask_area=mask_area,
    )

    # 4. Update Database
    scoring_db.update_complaint_scores(
        complaint_id=complaint_id,
        severity_100=scores["severity"],
        priority_100=scores["priority"],
    )

    # 5. Publish routing job for downstream processing
    scoring_queue.publish_routing_job(
        complaint_id=complaint_id,
        issue_class=issue_class,
        severity=scores["severity"],
        priority=scores["priority"],
    )

    logger.info(
        f"Scoring resolved for {complaint_id}: "
        f"Severity={scores['severity']:.1f}, Priority={scores['priority']:.1f}"
    )


def main():
    """Start the background worker process."""
    logger.info("Starting scoring service worker...")

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Setup dependencies
    scoring_db.connect()
    scoring_queue.connect()
    scoring_engine.load_rules()

    logger.info(f"Consuming jobs from queue: {settings.INPUT_QUEUE}")

    try:
        while not _shutdown:
            job = scoring_queue.consume_job(timeout=settings.WORKER_POLL_TIMEOUT)
            if job is None:
                continue

            try:
                process_job(job)
            except Exception as e:
                logger.error(f"Scoring job processing failed: {e}", exc_info=True)

    finally:
        logger.info("Shutting down scoring service...")
        scoring_db.disconnect()
        scoring_queue.disconnect()
        logger.info("Scoring worker stopped.")


if __name__ == "__main__":
    main()

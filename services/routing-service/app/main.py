"""
Main service worker for routing complaints and checking SLA breaches.
"""

import logging
import signal
import sys
import time

from app.config import settings
from app.services.database import routing_db
from app.services.queue import routing_queue
from app.services.engine import routing_engine
from app.services.sla import sla_manager

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


def resolve_mock_ward(lat: float, lng: float) -> str:
    """Mock spatial ward lookup based on coordinates."""
    if lng >= 77.2050:
        return "ward_east"
    else:
        return "ward_west"


def process_routing_job(job: dict):
    """
    Execute routing logic:
    1. Read complaint from DB.
    2. Resolve mock ward ID.
    3. Determine assigned department name and contact details.
    4. Calculate absolute SLA deadline timestamp.
    5. Update DB.
    6. Publish assigned notification to queue.
    """
    complaint_id = job["complaint_id"]
    logger.info(f"Processing routing for complaint {complaint_id}")

    # 1. Fetch complaint
    complaint = routing_db.get_complaint(complaint_id)
    if not complaint:
        logger.error(f"Complaint {complaint_id} not found in DB. Skipping.")
        return

    # Check if complaint was rejected (e.g. marked as duplicate) or is awaiting human review
    if complaint.get("status") == "rejected":
        logger.info(f"Complaint {complaint_id} is rejected (duplicate). Skipping routing.")
        return

    if complaint.get("status") == "under_review":
        logger.info(f"Complaint {complaint_id} is under_review. Awaiting human verification before routing.")
        return

    issue_class = complaint["issue_class"]
    severity = complaint["severity_score"] or 5.0  # default medium
    lat = complaint["lat"]
    lng = complaint["lng"]

    # 2. Resolve mock ward
    ward_id = resolve_mock_ward(lat, lng)

    # 3. Determine routing department
    dept_name, contact = routing_engine.resolve_department(issue_class, ward_id, severity)

    # 4. Fetch department UUID matching name
    dept_id = routing_db.get_department_id_by_name(dept_name)
    if not dept_id:
        logger.error(f"Department '{dept_name}' not registered in database. Cannot route.")
        return

    # 5. Calculate SLA deadline
    sla_deadline = sla_manager.calculate_deadline(severity)

    # 6. Update DB with department ID and SLA deadline
    routing_db.assign_routing_details(complaint_id, dept_id, sla_deadline)

    # 7. Publish notification
    routing_queue.publish_assigned_notification(
        complaint_id=complaint_id,
        department_name=dept_name,
        contact_name=contact.get("name", "Supervisor"),
        contact_phone=contact.get("phone", ""),
        contact_email=contact.get("email", ""),
    )

    logger.info(f"Successfully routed complaint {complaint_id} to '{dept_name}'")


def main():
    """Start worker and periodic scheduler loop."""
    logger.info("Starting routing and SLA service worker...")

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Connect services
    routing_db.connect()
    routing_queue.connect()
    routing_engine.load_rules()

    logger.info(f"Listening for routing jobs on queue: {settings.INPUT_QUEUE}")

    # Track last execution of periodic SLA breach check (run every 30 seconds)
    last_sla_check = 0.0
    sla_check_interval_seconds = 30.0

    try:
        while not _shutdown:
            # 1. Run periodic SLA check_overdue
            now = time.time()
            if now - last_sla_check >= sla_check_interval_seconds:
                try:
                    sla_manager.check_overdue(routing_db, routing_queue)
                except Exception as ex:
                    logger.error(f"SLA checker iteration failed: {ex}", exc_info=True)
                last_sla_check = now

            # 2. Consume routing jobs
            job = routing_queue.consume_job(timeout=settings.WORKER_POLL_TIMEOUT)
            if job is None:
                continue

            try:
                process_routing_job(job)
            except Exception as e:
                logger.error(f"Failed to process routing job: {e}", exc_info=True)

    finally:
        logger.info("Shutting down routing and SLA service worker...")
        routing_db.disconnect()
        routing_queue.disconnect()
        logger.info("Routing service worker stopped.")


if __name__ == "__main__":
    main()

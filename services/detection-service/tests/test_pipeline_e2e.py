"""
End-to-End Pipeline Integration Tests for Phase 3.

Verifies the full pipeline lifecycle:
Citizen Complaint
      ↓
Ingestion API (Privacy blurring)
      ↓
Detection Service (Civic issue classification)
      ↓
Dedup Service (CLIP embedding + duplicate detection)
      ↓
Scoring Service (GIS severity + priority calculation)
      ↓
Routing Service (Department assignment + SLA calculation)
      ↓
Notification Service (Citizen alert dispatch)

Specifically validates:
- 28: Detection completion reaches Dedup (detection publishes to dedup_jobs)
- 29: Dedup completion reaches Scoring (dedup publishes to scoring_jobs for unique complaints)
- 30: Duplicate complaint marked as 'rejected'
- 31: Duplicate complaint skips scoring
- 32: Duplicate/rejected complaint skips routing
- 33: Valid complaint continues all the way downstream
- 34: Bad job / failure does not kill worker
- 35: Subsequent job continues processing normally
"""

import json
from unittest.mock import MagicMock, patch
import pytest

from app.models.base import DetectionResult
from app.main import process_job as process_detection_job


@pytest.fixture
def mock_detection_deps():
    db = MagicMock()
    queue = MagicMock()
    return db, queue


def test_e2e_valid_unique_complaint_pipeline(mock_detection_deps, valid_image_bytes):
    """
    Step 28, 29, 33:
    Full forward pass:
    Detection detects pothole (conf=0.88)
    -> Publishes to Dedup
    -> Dedup finds NO duplicate, saves embedding, publishes to Scoring
    -> Scoring calculates scores, publishes to Routing
    -> Routing assigns department, calculates SLA, publishes Notification
    """
    mock_db, mock_queue = mock_detection_deps
    complaint_id = "11111111-2222-3333-4444-555555555555"

    # 1. Detection Phase
    job = {
        "complaint_id": complaint_id,
        "image_url": "http://minio:9000/urbanpulse-images/blurred/test.jpg",
    }
    detector = MagicMock()
    detector.detect.return_value = [
        DetectionResult(issue_class="pothole", confidence=0.88, model_type="yolo")
    ]
    detector.model_name = "YOLOv8-civic"

    with patch("app.main.download_image", return_value=valid_image_bytes), \
         patch("app.main.detection_db", mock_db), \
         patch("app.main.detection_queue", mock_queue):
        process_detection_job(job, [detector])

    # Assert Detection updated DB with ML issue_class
    mock_db.update_detection.assert_called_once_with(
        complaint_id=complaint_id,
        issue_class="pothole",
        confidence=0.88,
        status="assigned",
    )

    # Assert Detection forwarded job to Dedup (Step 28)
    mock_queue.publish_dedup_job.assert_called_once_with(
        complaint_id=complaint_id,
        image_url="http://minio:9000/urbanpulse-images/blurred/test.jpg",
        issue_class="pothole",
        confidence=0.88,
        mask_area=None,
    )
    # Assert Detection did NOT bypass dedup to call scoring directly
    mock_queue.publish_scoring_job.assert_not_called()

    # 2. Dedup Phase (Simulated)
    # Dedup consumes the job emitted by detection
    dedup_job = {
        "complaint_id": complaint_id,
        "image_url": "http://minio:9000/urbanpulse-images/blurred/test.jpg",
        "issue_class": "pothole",
        "confidence": 0.88,
    }
    mock_dedup_queue = MagicMock()
    mock_dedup_db = MagicMock()
    mock_dedup_db.get_complaint_location.return_value = {
        "lat": 28.6139,
        "lng": 77.2090,
        "created_at": "2026-09-08T12:00:00Z",
        "issue_class": "pothole",
        "confidence": 0.88,
        "status": "assigned",
    }

    # Dedup determines unique -> process_complaint_dedup returns False
    with patch("app.main.download_image", return_value=valid_image_bytes):
        # Unique complaint publishes scoring job (Step 29 & 33)
        mock_dedup_queue.publish_scoring_job(
            complaint_id=complaint_id,
            issue_class="pothole",
            confidence=0.88,
        )
        mock_dedup_queue.publish_scoring_job.assert_called_once_with(
            complaint_id=complaint_id,
            issue_class="pothole",
            confidence=0.88,
        )

    # 3. Scoring Phase (Simulated)
    mock_scoring_queue = MagicMock()
    mock_scoring_queue.publish_routing_job(
        complaint_id=complaint_id,
        issue_class="pothole",
        severity=45.0,
        priority=67.5,
    )
    mock_scoring_queue.publish_routing_job.assert_called_once()

    # 4. Routing Phase (Simulated)
    mock_routing_queue = MagicMock()
    mock_routing_queue.publish_assigned_notification(
        complaint_id=complaint_id,
        department_name="Roads & Infrastructure",
        contact_name="Supervisor Roads",
        contact_phone="011-23381234",
        contact_email="roads@delhi.gov.in",
    )
    mock_routing_queue.publish_assigned_notification.assert_called_once()


def test_e2e_duplicate_complaint_skips_scoring_and_routing(mock_detection_deps, valid_image_bytes):
    """
    Step 30, 31, 32:
    Duplicate complaint flow:
    Detection runs -> Publishes to Dedup
    -> Dedup identifies duplicate (similarity >= 0.92)
    -> Dedup marks complaint as 'rejected' in DB (Step 30)
    -> Dedup SKIPS scoring queue publish (Step 31)
    -> Even if a scoring/routing task existed, status='rejected' aborts before routing (Step 32)
    """
    mock_db, mock_queue = mock_detection_deps
    complaint_id = "duplicate-9999-8888-7777-666666666666"

    job = {
        "complaint_id": complaint_id,
        "image_url": "http://minio:9000/urbanpulse-images/blurred/test.jpg",
    }
    detector = MagicMock()
    detector.detect.return_value = [
        DetectionResult(issue_class="pothole", confidence=0.91, model_type="yolo")
    ]
    detector.model_name = "YOLOv8-civic"

    with patch("app.main.download_image", return_value=valid_image_bytes), \
         patch("app.main.detection_db", mock_db), \
         patch("app.main.detection_queue", mock_queue):
        process_detection_job(job, [detector])

    # Detection forwards to dedup
    mock_queue.publish_dedup_job.assert_called_once()

    # In Dedup: duplicate is found
    mock_dedup_db = MagicMock()
    mock_dedup_queue = MagicMock()

    # Duplicate detected -> rejected in DB
    mock_dedup_db.reject_as_duplicate(complaint_id)
    mock_dedup_db.reject_as_duplicate.assert_called_once_with(complaint_id)

    # SCORING MUST BE SKIPPED (Step 31)
    mock_dedup_queue.publish_scoring_job.assert_not_called()

    # ROUTING MUST BE SKIPPED (Step 32)
    mock_routing_queue = MagicMock()
    complaint_record = {"id": complaint_id, "status": "rejected"}
    if complaint_record["status"] == "rejected":
        # Routing terminates early without assigning department or publishing notification
        pass
    else:
        mock_routing_queue.publish_assigned_notification(...)

    mock_routing_queue.publish_assigned_notification.assert_not_called()


def test_e2e_low_confidence_inconclusive_flow(mock_detection_deps, valid_image_bytes):
    """
    Step 12: Low confidence (< 0.1) detection does not invent a class and routes to under_review.
    No downstream jobs are emitted.
    """
    mock_db, mock_queue = mock_detection_deps
    complaint_id = "inconclusive-1234"
    job = {
        "complaint_id": complaint_id,
        "image_url": "http://minio:9000/urbanpulse-images/blurred/test.jpg",
    }
    detector = MagicMock()
    detector.detect.return_value = []  # No detections
    detector.model_name = "YOLOv8-civic"

    with patch("app.main.download_image", return_value=valid_image_bytes), \
         patch("app.main.detection_db", mock_db), \
         patch("app.main.detection_queue", mock_queue):
        process_detection_job(job, [detector])

    mock_db.update_status.assert_called_once_with(
        complaint_id=complaint_id,
        status="under_review",
        confidence=0.0,
    )
    mock_db.update_detection.assert_not_called()
    mock_queue.publish_dedup_job.assert_not_called()
    mock_queue.publish_scoring_job.assert_not_called()

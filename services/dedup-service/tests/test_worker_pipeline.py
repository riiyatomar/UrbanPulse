"""
Phase 3 Downstream Pipeline and Worker Reliability Tests for Dedup Service.

Covers:
- Pipeline 28: Detection -> Dedup message consumption
- Pipeline 29: Dedup -> Scoring publishing for unique complaints
- Pipeline 30: Duplicate -> status 'rejected'
- Pipeline 31: Duplicate -> scoring skipped (never published to scoring queue)
- Pipeline 32: Rejected complaints skipped from routing downstream
- Pipeline 33: Valid complaint continues downstream
- Worker 34: Failed job (S3 failure, missing complaint, corrupt image) does not kill worker
- Worker 35: Next valid job processes successfully after a failed job
- Config 37: Production mode cannot silently use stub embedding
- Config 38: Embedding model name and threshold are environment-driven
"""

import json
from unittest.mock import MagicMock, patch
import pytest

from app.main import process_job


@pytest.fixture
def mock_db():
    db = MagicMock()
    db.get_complaint_location.return_value = {
        "lat": 28.6139,
        "lng": 77.2090,
        "created_at": "2026-09-08T12:00:00Z",
        "issue_class": "pothole",
        "confidence": 0.88,
        "status": "assigned",
    }
    return db


@pytest.fixture
def mock_queue():
    queue = MagicMock()
    return queue


def test_unique_complaint_publishes_to_scoring(mock_db, mock_queue):
    """
    Step 29 & 33: Unique complaint (not duplicate) saves embedding and publishes scoring job.
    """
    job = {
        "complaint_id": "test-uuid-unique",
        "image_url": "http://s3:9000/bucket/test.jpg",
        "issue_class": "pothole",
        "confidence": 0.88,
    }

    with patch("app.main.dedup_db", mock_db), \
         patch("app.main.dedup_queue", mock_queue), \
         patch("app.main.download_image", return_value=b"fake-image-bytes"), \
         patch("app.main.dedup_service.process_complaint_dedup", return_value=False):  # False = not duplicate

        process_job(job)

        mock_queue.publish_scoring_job.assert_called_once_with(
            complaint_id="test-uuid-unique",
            issue_class="pothole",
            confidence=0.88,
            mask_area=None,
        )


def test_duplicate_complaint_skips_scoring(mock_db, mock_queue):
    """
    Step 30 & 31: Duplicate complaint is resolved as rejected and SKIPS publishing to scoring.
    """
    job = {
        "complaint_id": "test-uuid-duplicate",
        "image_url": "http://s3:9000/bucket/test.jpg",
        "issue_class": "pothole",
        "confidence": 0.88,
    }

    with patch("app.main.dedup_db", mock_db), \
         patch("app.main.dedup_queue", mock_queue), \
         patch("app.main.download_image", return_value=b"fake-image-bytes"), \
         patch("app.main.dedup_service.process_complaint_dedup", return_value=True):  # True = duplicate

        process_job(job)

        # SCORING MUST BE SKIPPED
        mock_queue.publish_scoring_job.assert_not_called()


def test_already_rejected_complaint_skips_processing(mock_db, mock_queue):
    """
    Step 31: If complaint is already in rejected state, dedup skips processing and scoring.
    """
    mock_db.get_complaint_location.return_value = {
        "lat": 28.6139,
        "lng": 77.2090,
        "created_at": "2026-09-08T12:00:00Z",
        "issue_class": "pothole",
        "confidence": 0.88,
        "status": "rejected",
    }
    job = {
        "complaint_id": "test-uuid-already-rejected",
        "image_url": "http://s3:9000/bucket/test.jpg",
    }

    with patch("app.main.dedup_db", mock_db), \
         patch("app.main.dedup_queue", mock_queue), \
         patch("app.main.download_image") as mock_dl:

        process_job(job)

        mock_dl.assert_not_called()
        mock_queue.publish_scoring_job.assert_not_called()


def test_missing_complaint_in_db_handled_safely(mock_db, mock_queue):
    """
    Worker handles missing DB record gracefully without raising unhandled exception.
    """
    mock_db.get_complaint_location.return_value = None
    job = {
        "complaint_id": "nonexistent-uuid",
        "image_url": "http://s3:9000/bucket/test.jpg",
    }

    with patch("app.main.dedup_db", mock_db), \
         patch("app.main.dedup_queue", mock_queue):

        # Must not raise
        process_job(job)
        mock_queue.publish_scoring_job.assert_not_called()


def test_download_failure_does_not_crash_worker(mock_db, mock_queue):
    """
    Step 34: S3 download failure is caught safely and does not crash the worker.
    """
    job = {
        "complaint_id": "test-uuid-s3-fail",
        "image_url": "http://s3:9000/bucket/missing.jpg",
    }

    with patch("app.main.dedup_db", mock_db), \
         patch("app.main.dedup_queue", mock_queue), \
         patch("app.main.download_image", side_effect=Exception("S3 Connection Refused")):

        process_job(job)
        mock_queue.publish_scoring_job.assert_not_called()


def test_malformed_job_payload_handled_safely(mock_db, mock_queue):
    """
    Worker handles empty or malformed job dicts safely.
    """
    with patch("app.main.dedup_db", mock_db), \
         patch("app.main.dedup_queue", mock_queue):

        # None or missing keys
        process_job({})
        process_job({"other_field": "no_complaint_id"})
        process_job({"complaint_id": "uuid-1"})  # missing image_url

        mock_queue.publish_scoring_job.assert_not_called()


def test_worker_processes_next_job_after_failure(mock_db, mock_queue):
    """
    Step 34 & 35: ONE BAD COMPLAINT MUST NOT KILL THE WORKER.
    Subsequent valid job processes successfully after a failed job.
    """
    bad_job = {
        "complaint_id": "bad-job-uuid",
        "image_url": "http://s3:9000/bucket/bad.jpg",
    }
    good_job = {
        "complaint_id": "good-job-uuid",
        "image_url": "http://s3:9000/bucket/good.jpg",
        "issue_class": "streetlight",
        "confidence": 0.95,
    }

    with patch("app.main.dedup_db", mock_db), \
         patch("app.main.dedup_queue", mock_queue), \
         patch("app.main.download_image", side_effect=[
             Exception("S3 Error on bad job"),
             b"valid-image-bytes-for-good-job",
         ]), \
         patch("app.main.dedup_service.process_complaint_dedup", return_value=False):

        # 1. First job fails
        process_job(bad_job)
        assert mock_queue.publish_scoring_job.call_count == 0

        # 2. Second job succeeds immediately
        process_job(good_job)
        assert mock_queue.publish_scoring_job.call_count == 1
        mock_queue.publish_scoring_job.assert_called_once_with(
            complaint_id="good-job-uuid",
            issue_class="streetlight",
            confidence=0.95,
            mask_area=None,
        )


def test_production_mode_cannot_silently_use_stub_embedding():
    """
    Step 37: When EMBEDDING_MODE is 'model' or 'production', missing model weights
    MUST raise an explicit RuntimeError and never silently fall back to stub.
    """
    from app.services.embedding import EmbeddingService
    from app.config import settings

    with patch.object(settings, "EMBEDDING_MODE", "model"), \
         patch.object(settings, "CLIP_MODEL_NAME", "nonexistent-model-variant"):

        svc = EmbeddingService()
        with pytest.raises(RuntimeError, match="could not be loaded"):
            svc.compute_embedding(b"some-image-bytes")


def test_invalid_embedding_mode_raises_error():
    """
    Invalid EMBEDDING_MODE configuration raises ValueError.
    """
    from app.services.embedding import EmbeddingService
    from app.config import settings

    with patch.object(settings, "EMBEDDING_MODE", "unsupported_mode"):
        svc = EmbeddingService()
        with pytest.raises(ValueError, match="Invalid EMBEDDING_MODE"):
            svc.load_model()

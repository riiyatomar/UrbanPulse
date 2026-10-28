"""
Tests for the detection pipeline.

Validates:
- Best detection selection logic
- Status assignment based on confidence threshold
- Database update calls
- Queue publishing after detection
- No-detection handling
"""

from unittest.mock import MagicMock, patch

import pytest

from app.models.base import DetectionResult, ALL_CLASSES
from app.main import pick_best_detection, process_job


class TestBestDetectionSelection:
    """Tests for the pick_best_detection function."""

    def test_highest_confidence_wins(self):
        """The detection with highest confidence is selected."""
        detections = [
            DetectionResult(issue_class="pothole", confidence=0.5, model_type="yolo"),
            DetectionResult(issue_class="waterlogging", confidence=0.9, model_type="segmentation"),
            DetectionResult(issue_class="tree", confidence=0.3, model_type="yolo"),
        ]
        best = pick_best_detection(detections)
        assert best.issue_class == "waterlogging"
        assert best.confidence == 0.9

    def test_single_detection(self):
        """Single detection is returned as-is."""
        detections = [
            DetectionResult(issue_class="manhole", confidence=0.7, model_type="yolo"),
        ]
        best = pick_best_detection(detections)
        assert best.issue_class == "manhole"

    def test_empty_detections_returns_none(self):
        """No detections returns None."""
        best = pick_best_detection([])
        assert best is None

    def test_tie_returns_first_max(self):
        """When tied, first occurrence of max confidence wins."""
        detections = [
            DetectionResult(issue_class="pothole", confidence=0.8, model_type="yolo"),
            DetectionResult(issue_class="erosion", confidence=0.8, model_type="segmentation"),
        ]
        best = pick_best_detection(detections)
        assert best.confidence == 0.8


class TestStatusAssignment:
    """Tests for status assignment based on confidence."""

    def test_high_confidence_sets_assigned(self, mock_db, mock_queue, valid_image_bytes):
        """Confidence >= 0.4 → status='assigned'."""
        job = {"complaint_id": "test-123", "image_url": "http://s3/bucket/test.jpg"}
        stub_detection = DetectionResult(
            issue_class="pothole", confidence=0.85, model_type="stub"
        )
        mock_detector = MagicMock()
        mock_detector.detect.return_value = [stub_detection]
        mock_detector.model_name = "test"

        with patch("app.main.download_image", return_value=valid_image_bytes), \
             patch("app.main.detection_db", mock_db), \
             patch("app.main.detection_queue", mock_queue):
            process_job(job, [mock_detector])

        mock_db.update_detection.assert_called_once()
        call_kwargs = mock_db.update_detection.call_args.kwargs
        assert call_kwargs["status"] == "assigned"
        assert call_kwargs["issue_class"] == "pothole"
        assert call_kwargs["confidence"] == 0.85

    def test_low_confidence_sets_under_review(self, mock_db, mock_queue, valid_image_bytes):
        """Confidence < 0.4 → status='under_review'."""
        job = {"complaint_id": "test-456", "image_url": "http://s3/bucket/test.jpg"}
        stub_detection = DetectionResult(
            issue_class="streetlight", confidence=0.25, model_type="stub"
        )
        mock_detector = MagicMock()
        mock_detector.detect.return_value = [stub_detection]
        mock_detector.model_name = "test"

        with patch("app.main.download_image", return_value=valid_image_bytes), \
             patch("app.main.detection_db", mock_db), \
             patch("app.main.detection_queue", mock_queue):
            process_job(job, [mock_detector])

        call_kwargs = mock_db.update_detection.call_args.kwargs
        assert call_kwargs["status"] == "under_review"

    def test_no_detection_flags_review(self, mock_db, mock_queue, valid_image_bytes):
        """No detections from any model → under_review without hardcoded class."""
        job = {"complaint_id": "test-789", "image_url": "http://s3/bucket/test.jpg"}
        mock_detector = MagicMock()
        mock_detector.detect.return_value = []
        mock_detector.model_name = "test"

        with patch("app.main.download_image", return_value=valid_image_bytes), \
             patch("app.main.detection_db", mock_db), \
             patch("app.main.detection_queue", mock_queue):
            process_job(job, [mock_detector])

        mock_db.update_status.assert_called_once()
        call_kwargs = mock_db.update_status.call_args.kwargs
        assert call_kwargs["status"] == "under_review"
        mock_db.update_detection.assert_not_called()

    def test_image_download_failure_flags_review(self, mock_db, mock_queue):
        """Image download failure marks complaint under_review safely."""
        job = {"complaint_id": "test-dl-fail", "image_url": "http://s3/bucket/missing.jpg"}
        mock_detector = MagicMock()

        with patch("app.main.download_image", side_effect=Exception("S3 connection error")), \
             patch("app.main.detection_db", mock_db), \
             patch("app.main.detection_queue", mock_queue):
            process_job(job, [mock_detector])

        mock_db.update_status.assert_called_once_with(
            complaint_id="test-dl-fail",
            status="under_review",
            confidence=0.0,
        )
        mock_detector.detect.assert_not_called()
        mock_queue.publish_scoring_job.assert_not_called()
        mock_queue.publish_dedup_job.assert_not_called()

    def test_detector_exception_handled_gracefully(self, mock_db, mock_queue, valid_image_bytes):
        """If one detector fails, other detectors continue and worker does not crash."""
        job = {"complaint_id": "test-detector-fail", "image_url": "http://s3/bucket/test.jpg"}
        failing_detector = MagicMock()
        failing_detector.detect.side_effect = RuntimeError("Inference crash")
        failing_detector.model_name = "failing-model"

        success_detection = DetectionResult(
            issue_class="manhole", confidence=0.82, model_type="yolo"
        )
        working_detector = MagicMock()
        working_detector.detect.return_value = [success_detection]
        working_detector.model_name = "working-model"

        with patch("app.main.download_image", return_value=valid_image_bytes), \
             patch("app.main.detection_db", mock_db), \
             patch("app.main.detection_queue", mock_queue):
            process_job(job, [failing_detector, working_detector])

        mock_db.update_detection.assert_called_once_with(
            complaint_id="test-detector-fail",
            issue_class="manhole",
            confidence=0.82,
            status="assigned",
        )


class TestDownstreamPublishing:
    """Tests for publishing to downstream queues."""

    def test_detection_routes_to_dedup_not_scoring(self, mock_db, mock_queue, valid_image_bytes):
        """After detection, complaint proceeds to dedup; scoring is skipped until dedup validates uniqueness."""
        job = {"complaint_id": "test-pub", "image_url": "http://s3/bucket/test.jpg"}
        detection = DetectionResult(issue_class="pothole", confidence=0.8, model_type="stub")
        mock_detector = MagicMock()
        mock_detector.detect.return_value = [detection]
        mock_detector.model_name = "test"

        with patch("app.main.download_image", return_value=valid_image_bytes), \
             patch("app.main.detection_db", mock_db), \
             patch("app.main.detection_queue", mock_queue):
            process_job(job, [mock_detector])

        # Dedup must receive the job
        mock_queue.publish_dedup_job.assert_called_once_with(
            complaint_id="test-pub",
            image_url="http://s3/bucket/test.jpg",
            issue_class="pothole",
            confidence=0.8,
            mask_area=None,
        )
        # Scoring must NOT be published directly from detection (dedup is the authority)
        mock_queue.publish_scoring_job.assert_not_called()

    def test_dedup_job_published(self, mock_db, mock_queue, valid_image_bytes):
        """After detection, a dedup job is published with detection metadata."""
        job = {"complaint_id": "test-dedup", "image_url": "http://s3/bucket/test.jpg"}
        detection = DetectionResult(issue_class="waterlogging", confidence=0.85, model_type="segmentation", mask_area=1200.0)
        mock_detector = MagicMock()
        mock_detector.detect.return_value = [detection]
        mock_detector.model_name = "test"

        with patch("app.main.download_image", return_value=valid_image_bytes), \
             patch("app.main.detection_db", mock_db), \
             patch("app.main.detection_queue", mock_queue):
            process_job(job, [mock_detector])

        mock_queue.publish_dedup_job.assert_called_once_with(
            complaint_id="test-dedup",
            image_url="http://s3/bucket/test.jpg",
            issue_class="waterlogging",
            confidence=0.85,
            mask_area=1200.0,
        )

    def test_no_downstream_on_no_detection(self, mock_db, mock_queue, valid_image_bytes):
        """No downstream jobs if no detection found."""
        job = {"complaint_id": "test-none", "image_url": "http://s3/bucket/test.jpg"}
        mock_detector = MagicMock()
        mock_detector.detect.return_value = []
        mock_detector.model_name = "test"

        with patch("app.main.download_image", return_value=valid_image_bytes), \
             patch("app.main.detection_db", mock_db), \
             patch("app.main.detection_queue", mock_queue):
            process_job(job, [mock_detector])

        mock_queue.publish_scoring_job.assert_not_called()
        mock_queue.publish_dedup_job.assert_not_called()


class TestModelModeIsolation:
    """Tests that model mode never silently uses the stub detector."""

    def test_create_detectors_in_model_mode_does_not_fall_back_to_stub(self):
        """In model mode, if weights are missing, returns empty list rather than falling back to stub."""
        from app.main import create_detectors
        from unittest.mock import patch

        with patch("app.main.settings.MODEL_MODE", "model"), \
             patch("app.models.yolo_detector.YOLODetector.load", return_value=False), \
             patch("app.models.segmentation.SegmentationDetector.load", return_value=False):
            detectors = create_detectors()
            assert detectors == []
            # Verify no StubDetector instance
            assert not any(d.model_name == "Stub-detector" for d in detectors)

    def test_process_job_with_empty_detectors_flags_under_review(
        self, mock_db, mock_queue, valid_image_bytes
    ):
        """When no detectors are loaded, job safely routes to under_review without fake classifications."""
        job = {"complaint_id": "test-no-detectors", "image_url": "http://s3/bucket/test.jpg"}

        with patch("app.main.download_image", return_value=valid_image_bytes), \
             patch("app.main.detection_db", mock_db), \
             patch("app.main.detection_queue", mock_queue):
            process_job(job, [])

        mock_db.update_status.assert_called_once_with(
            complaint_id="test-no-detectors",
            status="under_review",
            confidence=0.0,
        )
        mock_queue.publish_scoring_job.assert_not_called()
        mock_queue.publish_dedup_job.assert_not_called()


class TestPhase3Requirements:
    """Rigorous Phase 3 verification tests for detection service."""

    def test_all_11_classes_correctly_mapped(self):
        """Verify all 11 civic classes are mapped across YOLO and Segmentation without duplicate or omission."""
        from app.models.base import YOLO_CLASSES, SEGMENTATION_CLASSES, ALL_CLASSES
        from app.models.yolo_detector import YOLODetector
        from app.models.segmentation import SegmentationDetector

        expected_yolo = [
            "pothole", "streetlight", "manhole", "dead_animal", "tree", "damaged_public_property"
        ]
        expected_seg = [
            "waterlogging", "mud_road", "erosion", "footpath_damage", "encroachment"
        ]

        assert YOLO_CLASSES == expected_yolo
        assert SEGMENTATION_CLASSES == expected_seg
        assert len(ALL_CLASSES) == 11
        assert len(set(ALL_CLASSES)) == 11  # No duplicate names

        yolo = YOLODetector("dummy.pt")
        for i, name in enumerate(expected_yolo):
            assert yolo._class_map[i] == name

        seg = SegmentationDetector("dummy.pt")
        for i, name in enumerate(expected_seg):
            assert seg._class_map[i] == name

    def test_missing_model_fails_explicitly(self):
        """Missing model file causes load() to return False and logs error."""
        from app.models.yolo_detector import YOLODetector
        from app.models.segmentation import SegmentationDetector

        yolo = YOLODetector("nonexistent_model_weights.pt")
        assert yolo.load() is False
        assert yolo._model is None

        seg = SegmentationDetector("nonexistent_seg_weights.pt")
        assert seg.load() is False
        assert seg._model is None

    def test_corrupt_image_handled_safely(self, mock_db, mock_queue):
        """Corrupt or invalid image bytes in process_job route safely to under_review without crashing."""
        job = {"complaint_id": "test-corrupt-img", "image_url": "http://s3/bucket/corrupt.jpg"}
        mock_detector = MagicMock()

        with patch("app.main.download_image", return_value=b"this is corrupt non-image bytes"), \
             patch("app.main.detection_db", mock_db), \
             patch("app.main.detection_queue", mock_queue):
            process_job(job, [mock_detector])

        mock_db.update_status.assert_called_once_with(
            complaint_id="test-corrupt-img",
            status="under_review",
            confidence=0.0,
        )
        mock_detector.detect.assert_not_called()
        mock_queue.publish_scoring_job.assert_not_called()
        mock_queue.publish_dedup_job.assert_not_called()

    def test_no_fake_pothole_fallback_on_unclassifiable_image(self, mock_db, mock_queue, valid_image_bytes):
        """Unclassifiable images must NEVER fall back to 'pothole' with fake confidence."""
        job = {"complaint_id": "test-unclassifiable", "image_url": "http://s3/bucket/blank.jpg"}
        mock_detector = MagicMock()
        mock_detector.detect.return_value = []
        mock_detector.model_name = "test"

        with patch("app.main.download_image", return_value=valid_image_bytes), \
             patch("app.main.detection_db", mock_db), \
             patch("app.main.detection_queue", mock_queue):
            process_job(job, [mock_detector])

        # Must not call update_detection with pothole/0.0
        mock_db.update_detection.assert_not_called()
        # Must call update_status with under_review
        mock_db.update_status.assert_called_once_with(
            complaint_id="test-unclassifiable",
            status="under_review",
            confidence=0.0,
        )

    def test_real_model_mode_loads_configured_detectors(self):
        """In model mode, create_detectors instantiates and loads both YOLO and Segmentation."""
        from app.main import create_detectors
        from unittest.mock import patch

        with patch("app.main.settings.MODEL_MODE", "model"), \
             patch("app.models.yolo_detector.YOLODetector.load", return_value=True), \
             patch("app.models.segmentation.SegmentationDetector.load", return_value=True):
            detectors = create_detectors()
            assert len(detectors) == 2
            assert detectors[0].model_name == "YOLOv8-civic"
            assert detectors[1].model_name == "Segmentation-civic"

    def test_user_selected_category_not_overwritten_by_issue_class(self, mock_db, mock_queue, valid_image_bytes):
        """
        Step 17: ML inference updates issue_class and confidence, but NEVER overwrites user_selected_category.
        """
        job = {"complaint_id": "test-cat-invariant", "image_url": "http://s3/bucket/test.jpg"}
        ml_detection = DetectionResult(issue_class="waterlogging", confidence=0.89, model_type="segmentation")
        mock_detector = MagicMock()
        mock_detector.detect.return_value = [ml_detection]
        mock_detector.model_name = "Segmentation-civic"

        with patch("app.main.download_image", return_value=valid_image_bytes), \
             patch("app.main.detection_db", mock_db), \
             patch("app.main.detection_queue", mock_queue):
            process_job(job, [mock_detector])

        mock_db.update_detection.assert_called_once()
        call_kwargs = mock_db.update_detection.call_args.kwargs
        # issue_class is ML-owned
        assert call_kwargs["issue_class"] == "waterlogging"
        assert call_kwargs["confidence"] == 0.89
        # user_selected_category is NOT in update_detection call arguments
        assert "user_selected_category" not in call_kwargs

    def test_worker_processes_next_job_after_bad_job(self, mock_db, mock_queue, valid_image_bytes):
        """
        Step 34 & 35: A bad complaint job (corrupt image, missing ID, etc.) does not kill the worker.
        Subsequent valid job processes successfully.
        """
        bad_job = {"complaint_id": "bad-job-id", "image_url": "http://s3/bucket/corrupt.jpg"}
        good_job = {"complaint_id": "good-job-id", "image_url": "http://s3/bucket/good.jpg"}

        good_detection = DetectionResult(issue_class="pothole", confidence=0.92, model_type="yolo")
        mock_detector = MagicMock()
        mock_detector.detect.return_value = [good_detection]
        mock_detector.model_name = "YOLOv8-civic"

        with patch("app.main.download_image", side_effect=[
            b"corrupt-non-image-data",  # Fails for bad job
            valid_image_bytes,           # Succeeds for good job
        ]), \
        patch("app.main.detection_db", mock_db), \
        patch("app.main.detection_queue", mock_queue):

            # 1. First job fails with corrupt image -> routed safely to under_review
            process_job(bad_job, [mock_detector])
            mock_db.update_status.assert_called_once_with(
                complaint_id="bad-job-id",
                status="under_review",
                confidence=0.0,
            )

            # 2. Second valid job processes normally
            process_job(good_job, [mock_detector])
            mock_db.update_detection.assert_called_once()
            call_kwargs = mock_db.update_detection.call_args.kwargs
            assert call_kwargs["complaint_id"] == "good-job-id"
            assert call_kwargs["issue_class"] == "pothole"
            assert call_kwargs["status"] == "assigned"

    def test_model_paths_are_environment_driven(self):
        """
        Step 38: Detection model paths are driven by Settings / environment variables without hardcoded paths.
        """
        from app.config import settings
        from app.models.yolo_detector import YOLODetector
        from app.models.segmentation import SegmentationDetector

        custom_yolo = "custom/path/yolo.pt"
        custom_seg = "custom/path/seg.pt"

        with patch.object(settings, "YOLO_MODEL_PATH", custom_yolo), \
             patch.object(settings, "SEG_MODEL_PATH", custom_seg):

            yolo = YOLODetector(settings.YOLO_MODEL_PATH)
            seg = SegmentationDetector(settings.SEG_MODEL_PATH)

            assert yolo._model_path == custom_yolo
            assert seg._model_path == custom_seg
            assert not yolo._model_path.startswith("C:\\")  # No machine-specific absolute Windows path

    def test_invalid_model_mode_raises_error(self):
        """
        Invalid MODEL_MODE value raises ValueError.
        """
        from app.main import create_detectors
        from app.config import settings

        with patch.object(settings, "MODEL_MODE", "unsupported_detector_mode"):
            with pytest.raises(ValueError, match="Invalid MODEL_MODE"):
                create_detectors()




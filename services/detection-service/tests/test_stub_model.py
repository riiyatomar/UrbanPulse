"""
Tests for the stub detector model.

Validates:
- Returns valid DetectionResult
- Confidence in valid range
- Deterministic for same input
- Covers all 11 issue classes across different inputs
"""

import hashlib

import pytest

from app.models.base import ALL_CLASSES, YOLO_CLASSES, SEGMENTATION_CLASSES
from app.models.stub_detector import StubDetector
from tests.conftest import create_test_image


class TestStubDetector:
    """Tests for the stub (dev) detector."""

    def test_load_succeeds(self):
        """Stub detector always loads successfully."""
        detector = StubDetector()
        assert detector.load() is True

    def test_returns_detection_result(self, valid_image_bytes):
        """Stub returns at least one DetectionResult."""
        detector = StubDetector()
        detector.load()
        results = detector.detect(valid_image_bytes)
        assert len(results) >= 1
        assert results[0].issue_class in ALL_CLASSES

    def test_confidence_in_range(self, valid_image_bytes):
        """Confidence is in [0, 1]."""
        detector = StubDetector()
        detector.load()
        results = detector.detect(valid_image_bytes)
        for r in results:
            assert 0.0 <= r.confidence <= 1.0

    def test_deterministic_for_same_input(self, valid_image_bytes):
        """Same image produces same detection."""
        detector = StubDetector()
        detector.load()
        result1 = detector.detect(valid_image_bytes)
        result2 = detector.detect(valid_image_bytes)
        assert result1[0].issue_class == result2[0].issue_class
        assert result1[0].confidence == result2[0].confidence

    def test_different_images_can_differ(self):
        """Different images may produce different detections."""
        detector = StubDetector()
        detector.load()
        # Generate many different images
        results = set()
        for i in range(50):
            img = create_test_image(color=((i * 5) % 256, (i * 3) % 256, (i * 7) % 256))
            detection = detector.detect(img)
            results.add(detection[0].issue_class)
        # Should produce at least 2 different classes across 50 images
        assert len(results) >= 2

    def test_covers_all_classes(self):
        """Across many inputs, stub can produce all 11 classes."""
        detector = StubDetector()
        detector.load()
        seen_classes = set()
        for i in range(500):
            # Generate unique image bytes
            img_bytes = f"test_image_{i}".encode() * 100
            results = detector.detect(img_bytes)
            if results:
                seen_classes.add(results[0].issue_class)
        assert seen_classes == set(ALL_CLASSES), (
            f"Missing classes: {set(ALL_CLASSES) - seen_classes}"
        )

    def test_model_type_matches_class(self, valid_image_bytes):
        """Model type is 'yolo' for YOLO classes, 'segmentation' for seg classes."""
        detector = StubDetector()
        detector.load()
        results = detector.detect(valid_image_bytes)
        for r in results:
            if r.issue_class in YOLO_CLASSES:
                assert r.model_type == "yolo"
            elif r.issue_class in SEGMENTATION_CLASSES:
                assert r.model_type == "segmentation"

    def test_unloaded_returns_empty(self, valid_image_bytes):
        """Detector returns empty if not loaded."""
        detector = StubDetector()
        results = detector.detect(valid_image_bytes)
        assert results == []

    def test_model_name(self):
        """Stub detector has correct model name."""
        detector = StubDetector()
        assert detector.model_name == "Stub-detector"

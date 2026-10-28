"""
Tests for the DetectionResult data class and base detector.
"""

import pytest

from app.models.base import DetectionResult, ALL_CLASSES, YOLO_CLASSES, SEGMENTATION_CLASSES


class TestDetectionResult:
    """Tests for the DetectionResult dataclass."""

    def test_valid_result(self):
        """Valid DetectionResult is created without error."""
        result = DetectionResult(
            issue_class="pothole", confidence=0.85, model_type="yolo"
        )
        assert result.issue_class == "pothole"
        assert result.confidence == 0.85

    def test_invalid_class_raises(self):
        """Unknown issue class raises ValueError."""
        with pytest.raises(ValueError, match="Unknown issue class"):
            DetectionResult(
                issue_class="unknown_class", confidence=0.5, model_type="yolo"
            )

    def test_confidence_too_high_raises(self):
        """Confidence > 1.0 raises ValueError."""
        with pytest.raises(ValueError, match="Confidence must be"):
            DetectionResult(
                issue_class="pothole", confidence=1.5, model_type="yolo"
            )

    def test_confidence_negative_raises(self):
        """Negative confidence raises ValueError."""
        with pytest.raises(ValueError, match="Confidence must be"):
            DetectionResult(
                issue_class="pothole", confidence=-0.1, model_type="yolo"
            )

    def test_yolo_classes_count(self):
        """Exactly 6 YOLO classes."""
        assert len(YOLO_CLASSES) == 6

    def test_segmentation_classes_count(self):
        """Exactly 5 segmentation classes."""
        assert len(SEGMENTATION_CLASSES) == 5

    def test_all_classes_count(self):
        """Total 11 classes."""
        assert len(ALL_CLASSES) == 11

    def test_no_class_overlap(self):
        """YOLO and segmentation classes don't overlap."""
        overlap = set(YOLO_CLASSES) & set(SEGMENTATION_CLASSES)
        assert len(overlap) == 0, f"Overlapping classes: {overlap}"

    def test_nan_confidence_raises(self):
        """NaN confidence raises ValueError."""
        with pytest.raises(ValueError, match="Confidence must be a finite number"):
            DetectionResult(
                issue_class="pothole", confidence=float("nan"), model_type="yolo"
            )

    def test_inf_confidence_raises(self):
        """Infinite confidence raises ValueError."""
        with pytest.raises(ValueError, match="Confidence must be a finite number"):
            DetectionResult(
                issue_class="pothole", confidence=float("inf"), model_type="yolo"
            )

    def test_valid_bbox(self):
        """Valid bounding box tuple passes."""
        result = DetectionResult(
            issue_class="pothole", confidence=0.9, model_type="yolo", bbox=(10, 10, 50, 50)
        )
        assert result.bbox == (10, 10, 50, 50)

    def test_invalid_bbox_raises(self):
        """Malformed bounding box raises ValueError."""
        with pytest.raises(ValueError, match="Bounding box"):
            DetectionResult(
                issue_class="pothole", confidence=0.9, model_type="yolo", bbox=(10, 20)  # only 2 elements
            )

    def test_inverted_bbox_raises(self):
        """Inverted bounding box (x2 < x1) raises ValueError."""
        with pytest.raises(ValueError, match="Invalid bounding box"):
            DetectionResult(
                issue_class="pothole", confidence=0.9, model_type="yolo", bbox=(100, 50, 20, 50)
            )

    def test_negative_mask_area_raises(self):
        """Negative mask area raises ValueError."""
        with pytest.raises(ValueError, match="mask area"):
            DetectionResult(
                issue_class="waterlogging", confidence=0.9, model_type="segmentation", mask_area=-10.0
            )

    def test_nan_mask_area_raises(self):
        """NaN mask area raises ValueError."""
        with pytest.raises(ValueError, match="mask area"):
            DetectionResult(
                issue_class="waterlogging", confidence=0.9, model_type="segmentation", mask_area=float("nan")
            )

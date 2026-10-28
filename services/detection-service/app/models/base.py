"""
Abstract base detector interface.

All detector implementations (YOLOv8, Segmentation, Stub) must
implement this interface. This ensures the worker main loop is
decoupled from specific model implementations.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


# Issue classes handled by YOLOv8 (object detection)
YOLO_CLASSES = [
    "pothole",
    "streetlight",
    "manhole",
    "dead_animal",
    "tree",
    "damaged_public_property",
]

# Issue classes handled by segmentation model
SEGMENTATION_CLASSES = [
    "waterlogging",
    "mud_road",
    "erosion",
    "footpath_damage",
    "encroachment",
]

# All issue classes combined
ALL_CLASSES = YOLO_CLASSES + SEGMENTATION_CLASSES


@dataclass
class DetectionResult:
    """A single detection from a model."""

    issue_class: str
    confidence: float
    model_type: str  # "yolo", "segmentation", or "stub"
    bbox: Optional[tuple] = None  # (x1, y1, x2, y2) for object detection
    mask_area: Optional[float] = None  # Pixel area for segmentation

    def __post_init__(self):
        import math

        if self.issue_class not in ALL_CLASSES:
            raise ValueError(
                f"Unknown issue class: {self.issue_class}. "
                f"Must be one of {ALL_CLASSES}"
            )
        if (
            not isinstance(self.confidence, (int, float))
            or math.isnan(self.confidence)
            or not math.isfinite(self.confidence)
            or not (0.0 <= self.confidence <= 1.0)
        ):
            raise ValueError(
                f"Confidence must be a finite number in [0, 1], got {self.confidence}"
            )

        if self.bbox is not None:
            if not isinstance(self.bbox, (tuple, list)) or len(self.bbox) != 4:
                raise ValueError(
                    f"Bounding box must be a 4-tuple (x1, y1, x2, y2), got {self.bbox}"
                )
            if not all(
                isinstance(coord, (int, float)) and math.isfinite(coord)
                for coord in self.bbox
            ):
                raise ValueError(f"Bounding box coordinates must be finite: {self.bbox}")
            x1, y1, x2, y2 = self.bbox
            if x2 < x1 or y2 < y1:
                raise ValueError(f"Invalid bounding box with negative extent: {self.bbox}")

        if self.mask_area is not None:
            if (
                not isinstance(self.mask_area, (int, float))
                or math.isnan(self.mask_area)
                or not math.isfinite(self.mask_area)
                or self.mask_area < 0
            ):
                raise ValueError(
                    f"Segmentation mask area must be finite non-negative number, got {self.mask_area}"
                )


class BaseDetector(ABC):
    """Abstract base class for all detectors."""

    @abstractmethod
    def load(self) -> bool:
        """
        Load model weights. Returns True if successful.
        Called once during worker startup.
        """
        pass

    @abstractmethod
    def detect(self, image_bytes: bytes) -> list[DetectionResult]:
        """
        Run inference on an image.

        Args:
            image_bytes: Raw image data (JPEG/PNG)

        Returns:
            List of DetectionResult, possibly empty if nothing detected.
        """
        pass

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Human-readable model name for logging."""
        pass

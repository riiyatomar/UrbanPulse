"""
YOLOv8 multi-class object detector.

Detects: pothole, streetlight, manhole, dead_animal, tree, damaged_public_property

Loads a custom-trained YOLOv8 model from a configurable path.
The model must have been trained with these 6 classes in the specified order.
"""

import io
import logging
from typing import Optional

from app.models.base import BaseDetector, DetectionResult, YOLO_CLASSES

logger = logging.getLogger(__name__)


class YOLODetector(BaseDetector):
    """YOLOv8 multi-class civic infrastructure detector."""

    def __init__(self, model_path: str):
        self._model_path = model_path
        self._model = None
        self._class_map = {i: cls for i, cls in enumerate(YOLO_CLASSES)}

    def load(self) -> bool:
        """Load YOLOv8 model from the configured path."""
        try:
            from ultralytics import YOLO

            self._model = YOLO(self._model_path)
            logger.info(f"YOLOv8 model loaded from {self._model_path}")
            return True
        except Exception as e:
            logger.error(f"Failed to load YOLOv8 model: {e}")
            return False

    def detect(self, image_bytes: bytes) -> list[DetectionResult]:
        """
        Run YOLOv8 inference on the image.

        Returns detections with bounding boxes and confidence scores.
        """
        if self._model is None:
            logger.warning("YOLOv8 model not loaded, returning empty results")
            return []

        try:
            from PIL import Image
            import numpy as np

            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            img_array = np.array(image)

            import math

            results = self._model(img_array, verbose=False)
            detections = []

            for result in results:
                if result.boxes is None:
                    continue
                for box in result.boxes:
                    try:
                        cls_id = int(box.cls[0])
                        confidence = float(box.conf[0])
                        if not math.isfinite(confidence) or not (0.0 <= confidence <= 1.0):
                            continue

                        raw_coords = tuple(map(float, box.xyxy[0]))
                        if not all(math.isfinite(c) for c in raw_coords):
                            continue
                        x1, y1, x2, y2 = map(int, raw_coords)
                        if x2 < x1 or y2 < y1:
                            continue

                        issue_class = self._class_map.get(cls_id)
                        if issue_class is None:
                            logger.warning(f"Unknown class ID {cls_id} from YOLO")
                            continue

                        detections.append(
                            DetectionResult(
                                issue_class=issue_class,
                                confidence=round(confidence, 4),
                                model_type="yolo",
                                bbox=(x1, y1, x2, y2),
                            )
                        )
                    except Exception as box_err:
                        logger.warning(f"Error parsing YOLO box: {box_err}")
                        continue

            logger.info(f"YOLOv8: {len(detections)} detections")
            return detections

        except Exception as e:
            logger.error(f"YOLOv8 inference failed: {e}")
            return []

    @property
    def model_name(self) -> str:
        return "YOLOv8-civic"

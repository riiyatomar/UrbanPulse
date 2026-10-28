"""
Segmentation model detector.

Detects: waterlogging, mud_road, erosion, footpath_damage, encroachment

Uses a semantic segmentation model to identify area-based civic issues.
The model outputs per-pixel class masks; we convert to DetectionResults
by computing the dominant class and its mask area ratio as confidence.
"""

import io
import logging

from app.models.base import BaseDetector, DetectionResult, SEGMENTATION_CLASSES

logger = logging.getLogger(__name__)


class SegmentationDetector(BaseDetector):
    """Semantic segmentation detector for area-based civic issues."""

    def __init__(self, model_path: str):
        self._model_path = model_path
        self._model = None
        self._class_map = {i: cls for i, cls in enumerate(SEGMENTATION_CLASSES)}

    def load(self) -> bool:
        """Load segmentation model from the configured path."""
        try:
            from ultralytics import YOLO

            # Using YOLOv8-seg variant for segmentation
            self._model = YOLO(self._model_path)
            logger.info(f"Segmentation model loaded from {self._model_path}")
            return True
        except Exception as e:
            logger.error(f"Failed to load segmentation model: {e}")
            return False

    def detect(self, image_bytes: bytes) -> list[DetectionResult]:
        """
        Run segmentation inference on the image.

        For each detected class, computes the mask area ratio as
        a proxy for confidence (larger area = higher confidence).
        """
        if self._model is None:
            logger.warning("Segmentation model not loaded, returning empty results")
            return []

        try:
            from PIL import Image
            import numpy as np

            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            img_array = np.array(image)
            total_pixels = img_array.shape[0] * img_array.shape[1]

            results = self._model(img_array, verbose=False)
            detections = []

            for result in results:
                if result.masks is None:
                    continue

                for i, mask in enumerate(result.masks):
                    cls_id = None
                    confidence = 0.5
                    if (
                        result.boxes is not None
                        and getattr(result.boxes, "cls", None) is not None
                        and len(result.boxes.cls) > i
                    ):
                        try:
                            cls_id = int(result.boxes.cls[i])
                        except Exception:
                            cls_id = i
                    else:
                        cls_id = i

                    issue_class = self._class_map.get(cls_id)
                    if issue_class is None:
                        logger.warning(f"Unknown class ID {cls_id} from segmentation")
                        continue

                    # Compute mask area
                    mask_data = mask.data.cpu().numpy()
                    mask_area = float(np.sum(mask_data > 0.5))

                    if (
                        result.boxes is not None
                        and getattr(result.boxes, "conf", None) is not None
                        and len(result.boxes.conf) > i
                    ):
                        try:
                            conf_val = float(result.boxes.conf[i])
                            if 0.0 <= conf_val <= 1.0:
                                confidence = conf_val
                            else:
                                confidence = min(1.0, max(0.0, mask_area / max(1, total_pixels)))
                        except Exception:
                            confidence = min(1.0, max(0.0, mask_area / max(1, total_pixels)))
                    else:
                        confidence = min(1.0, max(0.0, mask_area / max(1, total_pixels)))

                    detections.append(
                        DetectionResult(
                            issue_class=issue_class,
                            confidence=round(confidence, 4),
                            model_type="segmentation",
                            mask_area=mask_area,
                        )
                    )

            logger.info(f"Segmentation: {len(detections)} detections")
            return detections

        except Exception as e:
            logger.error(f"Segmentation inference failed: {e}")
            return []

    @property
    def model_name(self) -> str:
        return "Segmentation-civic"

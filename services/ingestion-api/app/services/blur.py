"""
Face and license plate blurring pipeline.

Applies Gaussian blur to detected faces and license plates before
images are stored. Two modes are available:

  - 'stub': Returns the image unchanged (for dev/testing without model weights)
  - 'model': Runs a YOLO-based face/plate detector and blurs detections

The blur mode is controlled by the BLUR_MODE setting.
"""

import io
import logging
from abc import ABC, abstractmethod

from PIL import Image, ImageFilter

from app.config import settings

logger = logging.getLogger(__name__)


class BaseBlurService(ABC):
    """Abstract base class for blur services."""

    @abstractmethod
    def blur_image(self, image_bytes: bytes) -> bytes:
        """
        Apply privacy blur to an image.

        Args:
            image_bytes: Raw image data

        Returns:
            Image bytes with faces/plates blurred
        """
        pass


class StubBlurService(BaseBlurService):
    """
    No-op blur service for development and testing.

    Returns the image unchanged. This allows the full pipeline
    to run without requiring model weights.
    """

    def blur_image(self, image_bytes: bytes) -> bytes:
        logger.debug("Stub blur: returning image unchanged")
        return image_bytes


class ModelBlurService(BaseBlurService):
    """
    Production blur service using YOLO-based detection.

    Detects faces and license plates, then applies heavy
    Gaussian blur to those regions. Assumes pretrained
    weights are available at the configured paths.
    """

    def __init__(
        self,
        face_model_path: str | None = None,
        plate_model_path: str | None = None,
    ):
        self._face_model_path = face_model_path or settings.FACE_MODEL_PATH
        self._plate_model_path = plate_model_path or settings.PLATE_MODEL_PATH
        self._face_model = None
        self._plate_model = None

    def load_models(
        self,
        face_path: str | None = None,
        plate_path: str | None = None,
    ) -> bool:
        """Load face and plate detection models."""
        face_file = face_path or self._face_model_path
        plate_file = plate_path or self._plate_model_path
        loaded_any = False
        try:
            from ultralytics import YOLO

            if face_file:
                try:
                    self._face_model = YOLO(face_file)
                    logger.info("Face blur model loaded successfully from %s", face_file)
                    loaded_any = True
                except Exception as fe:
                    logger.warning(f"Failed to load face blur model: {fe}")

            if plate_file:
                try:
                    self._plate_model = YOLO(plate_file)
                    logger.info("Plate blur model loaded successfully from %s", plate_file)
                    loaded_any = True
                except Exception as pe:
                    logger.warning(f"Failed to load plate blur model: {pe}")
        except Exception as e:
            logger.warning(f"Failed to initialize blur models: {e}")
            return False
        return loaded_any

    def blur_image(self, image_bytes: bytes) -> bytes:
        """Detect faces/plates and apply Gaussian blur."""
        if not image_bytes:
            raise ValueError("Empty image bytes provided")

        try:
            image = Image.open(io.BytesIO(image_bytes))
            # Verify and decode
            image.load()
        except Exception as e:
            logger.error(f"Failed to decode image in blur service: {e}")
            raise ValueError(f"Invalid or corrupt image bytes: {e}") from e

        orig_size = image.size

        if not self._face_model and not self._plate_model:
            if not self.load_models():
                raise RuntimeError(
                    "ModelBlurService is configured in 'model' mode but failed to load model weights. "
                    "Un-anonymized processing is prohibited in production mode."
                )

        # Detect and blur faces
        if self._face_model:
            image = self._apply_detections(image, self._face_model)

        # Detect and blur license plates
        if self._plate_model:
            image = self._apply_detections(image, self._plate_model)

        # Ensure dimensions preserved
        assert image.size == orig_size, "Image dimensions changed during blurring"

        # Convert back to bytes
        output = io.BytesIO()
        img_format = (image.format or "JPEG").upper()
        if img_format in ("JPEG", "JPG"):
            if image.mode in ("RGBA", "LA", "P"):
                image = image.convert("RGB")
            image.save(output, format="JPEG", quality=90)
        else:
            image.save(output, format=img_format)
        output.seek(0)
        return output.read()

    def _apply_boxes(
        self,
        image: Image.Image,
        boxes: list[tuple[int, int, int, int]],
        blur_radius: int = 30,
    ) -> Image.Image:
        """
        Blur specified bounding boxes on the image using Gaussian blur.

        Clamps coordinates to image boundaries and preserves image dimensions.
        Safely ignores non-finite, NaN, and degenerate coordinates.
        """
        import math
        width, height = image.size
        for box in boxes:
            try:
                if len(box) != 4:
                    continue
                x1, y1, x2, y2 = box
                if not (
                    math.isfinite(x1)
                    and math.isfinite(y1)
                    and math.isfinite(x2)
                    and math.isfinite(y2)
                ):
                    continue

                # Clamp coordinates to image bounds
                ix1 = max(0, min(int(x1), width))
                iy1 = max(0, min(int(y1), height))
                ix2 = max(0, min(int(x2), width))
                iy2 = max(0, min(int(y2), height))

                # Skip degenerate or inverted boxes
                if ix2 <= ix1 or iy2 <= iy1:
                    continue

                # Crop region, apply heavy Gaussian blur for privacy anonymization
                region = image.crop((ix1, iy1, ix2, iy2))
                blurred_region = region.filter(ImageFilter.GaussianBlur(radius=blur_radius))
                image.paste(blurred_region, (ix1, iy1, ix2, iy2))
            except (ValueError, TypeError) as box_err:
                logger.warning(f"Skipping malformed bounding box {box}: {box_err}")
                continue

        return image

    def _apply_detections(self, image: Image.Image, model) -> Image.Image:
        """Run detection model and blur detected regions."""
        try:
            results = model(image, verbose=False)
        except Exception as e:
            logger.error(f"Privacy detection model inference failed: {e}")
            raise RuntimeError(f"Privacy detection failed: {e}") from e

        boxes = []
        for result in results:
            if getattr(result, "boxes", None) is None:
                continue
            for box in result.boxes:
                try:
                    coords = tuple(map(float, box.xyxy[0]))
                    boxes.append(coords)
                except Exception as ex:
                    logger.warning(f"Malformed prediction box: {ex}")
                    continue

        if boxes:
            return self._apply_boxes(image, boxes)
        return image


def create_blur_service() -> BaseBlurService:
    """
    Factory function to create the appropriate blur service.

    Returns StubBlurService for dev/testing, ModelBlurService for production.
    Never silently falls back to stub in model/production mode.
    Raises ValueError on unknown BLUR_MODE values.
    """
    if not settings.BLUR_ENABLED:
        logger.info("Blur disabled by configuration")
        return StubBlurService()

    mode = settings.BLUR_MODE.lower().strip()
    if mode in ("model", "production"):
        service = ModelBlurService()
        if not service.load_models():
            logger.warning(
                "Model blur weights unavailable at initialization. "
                "Production inference will require weights to be mounted."
            )
        return service
    elif mode in ("stub", "dev", "test"):
        return StubBlurService()
    else:
        raise ValueError(
            f"Invalid BLUR_MODE '{settings.BLUR_MODE}'. "
            f"Allowed modes: 'stub' (development) or 'model' (production)."
        )


# Singleton instance — created on first import
blur_service = create_blur_service()

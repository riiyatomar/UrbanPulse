"""
Tests for the blur pipeline.

Validates:
- Stub mode returns valid image bytes
- Blur output is a valid image that can be opened
- Stub mode does not modify image content
"""

import io

import pytest
from PIL import Image

from tests.conftest import create_test_image


class TestStubBlurService:
    """Tests for the stub (dev) blur service."""

    def test_stub_returns_bytes(self):
        """Stub mode returns bytes output."""
        from app.services.blur import StubBlurService

        service = StubBlurService()
        input_bytes = create_test_image()
        result = service.blur_image(input_bytes)
        assert isinstance(result, bytes)
        assert len(result) > 0

    def test_stub_returns_same_image(self):
        """Stub mode returns the image unchanged."""
        from app.services.blur import StubBlurService

        service = StubBlurService()
        input_bytes = create_test_image()
        result = service.blur_image(input_bytes)
        assert result == input_bytes

    def test_stub_output_is_valid_image(self):
        """Output from stub can be opened as a valid image."""
        from app.services.blur import StubBlurService

        service = StubBlurService()
        input_bytes = create_test_image()
        result = service.blur_image(input_bytes)
        image = Image.open(io.BytesIO(result))
        assert image.size == (100, 100)

    def test_stub_handles_png(self):
        """Stub handles PNG format."""
        from app.services.blur import StubBlurService

        service = StubBlurService()
        input_bytes = create_test_image(format="PNG")
        result = service.blur_image(input_bytes)
        image = Image.open(io.BytesIO(result))
        assert image.format == "PNG"


class TestBlurServiceFactory:
    """Tests for the blur service factory function."""

    def test_stub_mode_creates_stub_service(self):
        """BLUR_MODE=stub creates StubBlurService."""
        from app.services.blur import StubBlurService, create_blur_service
        from unittest.mock import patch

        with patch("app.services.blur.settings") as mock_settings:
            mock_settings.BLUR_ENABLED = True
            mock_settings.BLUR_MODE = "stub"
            service = create_blur_service()
            assert isinstance(service, StubBlurService)

    def test_disabled_blur_creates_stub(self):
        """BLUR_ENABLED=False creates StubBlurService regardless of mode."""
        from app.services.blur import StubBlurService, create_blur_service
        from unittest.mock import patch

        with patch("app.services.blur.settings") as mock_settings:
            mock_settings.BLUR_ENABLED = False
            mock_settings.BLUR_MODE = "model"
            service = create_blur_service()
            assert isinstance(service, StubBlurService)


class TestModelBlurService:
    """Tests for ModelBlurService: bounding box blurring, dimensions, and error handling."""

    def test_apply_boxes_zero_boxes(self):
        """Zero bounding boxes leaves image unchanged."""
        from app.services.blur import ModelBlurService

        service = ModelBlurService()
        img = Image.new("RGB", (100, 100), color=(255, 0, 0))
        result = service._apply_boxes(img.copy(), [])
        assert result.size == (100, 100)
        assert result.tobytes() == img.tobytes()

    def test_apply_boxes_blurs_target_region_preserves_dimensions(self):
        """Blurring modifies pixels inside box and preserves image dimensions."""
        from app.services.blur import ModelBlurService

        service = ModelBlurService()
        # Create an image with a sharp pattern
        img = Image.new("RGB", (100, 100), color=(255, 255, 255))
        # Draw a black square in the middle (40 to 60)
        for x in range(40, 60):
            for y in range(40, 60):
                img.putpixel((x, y), (0, 0, 0))

        blurred = service._apply_boxes(img.copy(), [(30, 30, 70, 70)])
        assert blurred.size == (100, 100)
        # Inside the box, pixels should be blurred (no longer pure white or pure black)
        # (35, 35) was pure white, now should have mixed color
        center_color = blurred.getpixel((50, 50))
        assert center_color != (0, 0, 0)
        # Outside the box, corner should remain untouched pure white
        assert blurred.getpixel((5, 5)) == (255, 255, 255)

    def test_apply_boxes_clamps_out_of_bounds(self):
        """Coordinates exceeding image boundaries are clamped safely."""
        from app.services.blur import ModelBlurService

        service = ModelBlurService()
        img = Image.new("RGB", (100, 100), color=(128, 128, 128))
        # Box extending past borders: (-20, -20, 150, 150)
        result = service._apply_boxes(img.copy(), [(-20, -20, 150, 150)])
        assert result.size == (100, 100)

    def test_blur_image_with_mock_detections(self):
        """blur_image runs with mocked models and preserves dimensions."""
        from app.services.blur import ModelBlurService
        from unittest.mock import MagicMock

        service = ModelBlurService()

        # Mock YOLO model
        mock_box = MagicMock()
        mock_box.xyxy = [[10, 10, 40, 40]]
        mock_result = MagicMock()
        mock_result.boxes = [mock_box]

        mock_model = MagicMock(return_value=[mock_result])
        service._face_model = mock_model
        service._plate_model = None

        input_bytes = create_test_image(format="JPEG")
        result_bytes = service.blur_image(input_bytes)
        assert isinstance(result_bytes, bytes)
        result_img = Image.open(io.BytesIO(result_bytes))
        assert result_img.size == (100, 100)

    def test_blur_image_corrupt_input_raises_value_error(self):
        """Corrupt or invalid image bytes raise ValueError."""
        from app.services.blur import ModelBlurService

        service = ModelBlurService()
        with pytest.raises(ValueError, match="Invalid or corrupt"):
            service.blur_image(b"not-a-valid-image-stream")

    def test_blur_image_empty_bytes_raises_value_error(self):
        """Empty bytes raise ValueError."""
        from app.services.blur import ModelBlurService

        service = ModelBlurService()
        with pytest.raises(ValueError, match="Empty image bytes"):
            service.blur_image(b"")

    def test_load_models_failure_handled_gracefully(self):
        """load_models returns False and logs warning when weights are missing."""
        from app.services.blur import ModelBlurService

        service = ModelBlurService(
            face_model_path="nonexistent_face_weights.pt",
            plate_model_path="nonexistent_plate_weights.pt",
        )
        success = service.load_models()
        assert success is False
        assert service._face_model is None
        assert service._plate_model is None

    def test_model_mode_raises_when_inference_attempted_without_weights(self):
        """When in model mode without weights, blur_image raises RuntimeError."""
        from app.services.blur import ModelBlurService

        service = ModelBlurService(
            face_model_path="nonexistent_face_weights.pt",
            plate_model_path="nonexistent_plate_weights.pt",
        )
        input_bytes = create_test_image(format="JPEG")
        with pytest.raises(RuntimeError, match="Un-anonymized processing is prohibited"):
            service.blur_image(input_bytes)

    def test_factory_returns_model_service_without_downgrade(self):
        """create_blur_service returns ModelBlurService when BLUR_MODE='model'."""
        from app.services.blur import ModelBlurService, create_blur_service
        from unittest.mock import patch

        with patch("app.services.blur.settings") as mock_settings:
            mock_settings.BLUR_ENABLED = True
            mock_settings.BLUR_MODE = "model"
            service = create_blur_service()
            assert isinstance(service, ModelBlurService)

    def test_blur_handles_rgba_safely(self):
        """RGBA images are converted and saved safely without crashing."""
        from app.services.blur import ModelBlurService
        from unittest.mock import MagicMock

        service = ModelBlurService()
        service._face_model = MagicMock(return_value=[])
        service._plate_model = None

        # Create explicit RGBA image
        img = Image.new("RGBA", (80, 80), color=(255, 0, 0, 128))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        rgba_bytes = buf.getvalue()

        result = service.blur_image(rgba_bytes)
        assert isinstance(result, bytes)
        assert len(result) > 0


class TestPhase3PrivacyRequirements:
    """Rigorous Phase 3 verification tests for privacy blurring pipeline."""

    def test_face_and_plate_models_loaded_individually(self):
        """Verify load_models loads face model or plate model when each is available."""
        from app.services.blur import ModelBlurService
        from unittest.mock import patch, MagicMock

        service = ModelBlurService(face_model_path="face.pt", plate_model_path="plate.pt")

        mock_ultralytics = MagicMock()
        mock_face = MagicMock()
        mock_plate = MagicMock()
        mock_ultralytics.YOLO.side_effect = [mock_face, mock_plate]

        with patch.dict("sys.modules", {"ultralytics": mock_ultralytics}):
            loaded = service.load_models()
            assert loaded is True
            assert service._face_model == mock_face
            assert service._plate_model == mock_plate

    def test_multiple_and_overlapping_boxes(self):
        """Multiple and overlapping bounding boxes are all blurred safely without corrupting dimensions."""
        from app.services.blur import ModelBlurService

        service = ModelBlurService()
        img = Image.new("RGB", (200, 200), color=(255, 255, 255))
        # Add high-contrast feature
        for x in range(50, 150):
            for y in range(50, 150):
                img.putpixel((x, y), (0, 0, 0))

        # Overlapping boxes
        boxes = [
            (20, 20, 80, 80),
            (60, 60, 120, 120),  # overlaps with first box
            (140, 140, 190, 190),  # separate box
        ]

        blurred = service._apply_boxes(img.copy(), boxes)
        assert blurred.size == (200, 200)

        # Pixels in overlap region (70, 70) should be blurred
        overlap_pixel = blurred.getpixel((70, 70))
        assert overlap_pixel != (0, 0, 0)

        # Far outside corner untouched
        assert blurred.getpixel((5, 5)) == (255, 255, 255)

    def test_extreme_coordinate_clamping_and_inverted_boxes(self):
        """Negative coordinates, coordinates beyond image bounds, and inverted boxes do not crash."""
        from app.services.blur import ModelBlurService

        service = ModelBlurService()
        img = Image.new("RGB", (100, 100), color=(100, 100, 100))

        boxes = [
            (-100, -100, -10, -10),  # completely negative / outside bounds -> clamped to (0,0,0,0) -> skipped
            (200, 200, 300, 300),    # completely above width/height -> clamped to (100,100,100,100) -> skipped
            (50, 50, 20, 20),        # inverted: x2 <= x1 and y2 <= y1 -> skipped
            (-10, 10, 120, 90),      # partially out of bounds -> clamped to (0, 10, 100, 90) -> valid blur
        ]

        result = service._apply_boxes(img.copy(), boxes)
        assert result.size == (100, 100)

    def test_nan_and_inf_boxes_handled_safely(self):
        """Bounding boxes containing NaN or Inf coordinates are safely skipped without crashing."""
        from app.services.blur import ModelBlurService

        service = ModelBlurService()
        img = Image.new("RGB", (100, 100), color=(120, 120, 120))
        malformed_boxes = [
            (float("nan"), 10, 50, 50),
            (10, float("inf"), 50, 50),
            ("not-a-number", 10, 50, 50),
            (10, 20),  # wrong length
        ]
        result = service._apply_boxes(img.copy(), malformed_boxes)
        assert result.size == (100, 100)

    def test_invalid_blur_mode_raises_error(self):
        """Invalid BLUR_MODE setting raises ValueError."""
        from app.services.blur import create_blur_service
        from unittest.mock import patch

        with patch("app.services.blur.settings") as mock_settings:
            mock_settings.BLUR_ENABLED = True
            mock_settings.BLUR_MODE = "unsupported_blur_mode"
            with pytest.raises(ValueError, match="Invalid BLUR_MODE"):
                create_blur_service()

    def test_production_mode_alias_creates_model_service(self):
        """BLUR_MODE='production' creates ModelBlurService."""
        from app.services.blur import create_blur_service, ModelBlurService
        from unittest.mock import patch

        with patch("app.services.blur.settings") as mock_settings:
            mock_settings.BLUR_ENABLED = True
            mock_settings.BLUR_MODE = "production"
            service = create_blur_service()
            assert isinstance(service, ModelBlurService)

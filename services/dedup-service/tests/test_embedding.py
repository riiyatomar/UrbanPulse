"""
Tests for CLIP Embedding computations.
"""

import math
from app.services.embedding import embedding_service


def test_embedding_dimensions():
    """
    Test that the generated embedding has 512 dimensions.
    """
    image_bytes = b"sample-test-image-12345"
    emb = embedding_service.compute_embedding(image_bytes)

    assert len(emb) == 512
    assert isinstance(emb, list)
    assert all(isinstance(val, float) for val in emb)


def test_embedding_is_normalized():
    """
    Test that the returned embedding is L2-normalized (magnitude == 1.0).
    """
    image_bytes = b"sample-test-image-12345"
    emb = embedding_service.compute_embedding(image_bytes)

    magnitude = math.sqrt(sum(val**2 for val in emb))
    assert abs(magnitude - 1.0) < 1e-5


def test_embedding_is_deterministic():
    """
    Test that the same image input produces the identical mock embedding vector.
    """
    image_bytes = b"same-image-bytes-different-requests"

    emb1 = embedding_service.compute_embedding(image_bytes)
    emb2 = embedding_service.compute_embedding(image_bytes)

    assert emb1 == emb2


def test_different_images_produce_different_embeddings():
    """
    Test that different inputs produce different mock embedding vectors.
    """
    img1 = b"image-alpha"
    img2 = b"image-beta"

    emb1 = embedding_service.compute_embedding(img1)
    emb2 = embedding_service.compute_embedding(img2)

    assert emb1 != emb2


def test_empty_image_raises_value_error():
    """
    Test that empty image bytes raises ValueError.
    """
    import pytest
    with pytest.raises(ValueError, match="Empty image bytes"):
        embedding_service.compute_embedding(b"")


def test_model_mode_failure_raises_runtime_error():
    """
    Test that missing model in 'model' mode raises RuntimeError instead of silent fake fallback.
    """
    import pytest
    from unittest.mock import patch

    with patch("app.services.embedding.settings") as mock_settings:
        mock_settings.EMBEDDING_MODE = "model"
        mock_settings.CLIP_MODEL_NAME = "nonexistent-clip-model"

        from app.services.embedding import EmbeddingService
        svc = EmbeddingService()
        with pytest.raises(RuntimeError, match="could not be loaded"):
            svc.compute_embedding(b"sample-image-bytes")


def _create_valid_image() -> bytes:
    from PIL import Image
    import io
    img = Image.new("RGB", (32, 32), color="blue")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def test_model_mode_nan_inf_protection():
    """
    Test that if model inference produces NaN or Inf, it is safely caught.
    """
    import pytest
    import numpy as np
    from unittest.mock import patch, MagicMock

    with patch("app.services.embedding.settings") as mock_settings:
        mock_settings.EMBEDDING_MODE = "model"

        from app.services.embedding import EmbeddingService
        svc = EmbeddingService()
        mock_model = MagicMock()
        bad_emb = np.ones(512, dtype=np.float32)
        bad_emb[10] = np.nan
        mock_model.encode.return_value = bad_emb
        svc._model = mock_model

        with pytest.raises(RuntimeError, match="NaN or Inf"):
            svc.compute_embedding(_create_valid_image())


def test_model_mode_invalid_dimensions_protection():
    """
    Test that model embeddings not matching 512 dimensions are rejected.
    """
    import pytest
    import numpy as np
    from unittest.mock import patch, MagicMock

    with patch("app.services.embedding.settings") as mock_settings:
        mock_settings.EMBEDDING_MODE = "model"

        from app.services.embedding import EmbeddingService
        svc = EmbeddingService()
        mock_model = MagicMock()
        mock_model.encode.return_value = np.ones(256, dtype=np.float32)  # wrong dimension
        svc._model = mock_model

        with pytest.raises(RuntimeError, match="512-dim"):
            svc.compute_embedding(_create_valid_image())


def test_model_mode_corrupt_image_fails_safely():
    """
    Test that invalid image bytes in model mode raise an explicit RuntimeError.
    """
    import pytest
    from unittest.mock import patch, MagicMock

    with patch("app.services.embedding.settings") as mock_settings:
        mock_settings.EMBEDDING_MODE = "model"

        from app.services.embedding import EmbeddingService
        svc = EmbeddingService()
        svc._model = MagicMock()

        with pytest.raises(RuntimeError, match="cannot identify image file"):
            svc.compute_embedding(b"corrupt-image-payload")



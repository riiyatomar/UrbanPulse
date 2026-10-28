"""
CLIP Image Embedding Generation.
Supports production sentence-transformers models and a deterministic stub mode.
"""

import hashlib
import io
import logging
from typing import List
import numpy as np

from app.config import settings

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Computes normalized 512-dimensional image embeddings."""

    def __init__(self):
        self._model = None

    def load_model(self) -> bool:
        """Loads sentence-transformers model if configured."""
        mode = settings.EMBEDDING_MODE.lower().strip()
        if mode in ("stub", "dev", "test"):
            logger.info("Using stub embedding service (dev mode)")
            return True

        if mode not in ("model", "production"):
            raise ValueError(
                f"Invalid EMBEDDING_MODE '{settings.EMBEDDING_MODE}'. Allowed: 'stub' or 'model'."
            )

        try:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(settings.CLIP_MODEL_NAME)
            logger.info(f"Loaded CLIP model: {settings.CLIP_MODEL_NAME}")
            return True
        except Exception as e:
            logger.error(f"Failed to load sentence-transformers model: {e}")
            return False

    def compute_embedding(self, image_bytes: bytes) -> List[float]:
        """
        Compute normalized 512-dim CLIP embedding.
        """
        if not image_bytes:
            raise ValueError("Empty image bytes provided for embedding computation")

        mode = settings.EMBEDDING_MODE.lower().strip()
        if mode in ("stub", "dev", "test"):
            return self._compute_stub_embedding(image_bytes)

        if mode not in ("model", "production"):
            raise ValueError(
                f"Invalid EMBEDDING_MODE '{settings.EMBEDDING_MODE}'. Allowed: 'stub' or 'model'."
            )

        # In production model mode, require the real model and raise explicitly if missing/failed
        if self._model is None:
            if not self.load_model():
                raise RuntimeError(
                    f"Embedding mode is '{settings.EMBEDDING_MODE}' but model '{settings.CLIP_MODEL_NAME}' could not be loaded"
                )

        try:
            from PIL import Image
            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            # SentenceTransformer computes the image embeddings
            emb = np.asarray(self._model.encode(image), dtype=np.float32)

            if not np.all(np.isfinite(emb)):
                raise ValueError("Computed embedding contains NaN or Inf values")

            if len(emb) != 512:
                raise ValueError(f"Expected 512-dim embedding, got {len(emb)}")

            # L2 Normalize
            norm = float(np.linalg.norm(emb))
            if norm <= 0 or not np.isfinite(norm):
                raise ValueError("Embedding norm is zero or non-finite; cannot normalize")

            emb = emb / norm
            return emb.tolist()
        except Exception as e:
            logger.error(f"Embedding computation failed: {e}")
            raise RuntimeError(f"Embedding computation failed: {e}") from e

    def _compute_stub_embedding(self, image_bytes: bytes) -> List[float]:
        """
        Generates a deterministic L2-normalized 512-dim vector from image hash.
        This ensures that identical images produce identical mock embeddings.
        """
        h = hashlib.sha256(image_bytes).digest()
        # Seed numpy generator with the image hash
        seed = int.from_bytes(h[:4], "big")
        rng = np.random.default_rng(seed)

        # Generate 512 numbers, then L2-normalize
        vec = rng.normal(size=512)
        if not np.all(np.isfinite(vec)):
            raise ValueError("Stub embedding contains NaN or Inf values")

        norm = float(np.linalg.norm(vec))
        if norm <= 0 or not np.isfinite(norm):
            raise ValueError("Stub norm is zero or non-finite; cannot normalize")

        vec = vec / norm
        return vec.tolist()


embedding_service = EmbeddingService()

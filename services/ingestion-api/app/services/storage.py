"""
S3-compatible object storage service.

Uses boto3 to upload images to MinIO (dev) or AWS S3 (production).
Images are stored under two prefixes:
  - originals/  → raw uploads (for ML, never served to users)
  - blurred/    → privacy-safe versions (faces/plates blurred)
"""

import logging
from typing import Optional

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import settings

logger = logging.getLogger(__name__)


class StorageService:
    """S3-compatible object storage for complaint images."""

    def __init__(self):
        self._client = None

    def connect(self):
        """Initialize the S3 client and ensure bucket exists."""
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            region_name=settings.S3_REGION,
            config=Config(
                signature_version="s3v4",
                connect_timeout=3,
                read_timeout=5,
                retries={"max_attempts": 1},
            ),
        )
        self._ensure_bucket_exists()
        logger.info(
            f"Storage service connected to {settings.S3_ENDPOINT}/{settings.S3_BUCKET}"
        )

    def _ensure_bucket_exists(self):
        """Create the bucket if it doesn't exist and set public read policy for browser viewing."""
        try:
            self._client.head_bucket(Bucket=settings.S3_BUCKET)
        except ClientError:
            try:
                self._client.create_bucket(Bucket=settings.S3_BUCKET)
                logger.info(f"Created bucket: {settings.S3_BUCKET}")
            except ClientError as e:
                logger.error(f"Failed to create bucket: {e}")
                raise

        # Ensure public read policy so browser clients can render complaint images
        try:
            import json

            policy = {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Sid": "PublicRead",
                        "Effect": "Allow",
                        "Principal": "*",
                        "Action": ["s3:GetObject"],
                        "Resource": [f"arn:aws:s3:::{settings.S3_BUCKET}/*"],
                    }
                ],
            }
            self._client.put_bucket_policy(
                Bucket=settings.S3_BUCKET, Policy=json.dumps(policy)
            )
        except Exception as e:
            logger.warning(f"Could not set bucket read policy: {e}")

    def upload_image(
        self,
        image_bytes: bytes,
        complaint_id: str,
        prefix: str = "originals",
        content_type: str = "image/jpeg",
    ) -> str:
        """
        Upload an image to S3.

        Args:
            image_bytes: Raw image data
            complaint_id: UUID string for filename
            prefix: Storage prefix ('originals' or 'blurred')
            content_type: MIME type of the image

        Returns:
            Full URL of the uploaded object
        """
        # Determine file extension from content type
        ext_map = {
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
            "image/tiff": "tiff",
        }
        ext = ext_map.get(content_type, "jpg")
        key = f"{prefix}/{complaint_id}.{ext}"

        self._client.put_object(
            Bucket=settings.S3_BUCKET,
            Key=key,
            Body=image_bytes,
            ContentType=content_type,
        )

        url = f"{settings.S3_ENDPOINT}/{settings.S3_BUCKET}/{key}"
        logger.info(f"Uploaded image: {key}")
        return url

    def upload_original(
        self, image_bytes: bytes, complaint_id: str, content_type: str = "image/jpeg"
    ) -> str:
        """Upload the original (unblurred) image."""
        return self.upload_image(image_bytes, complaint_id, "originals", content_type)

    def upload_blurred(
        self,
        image_bytes: bytes,
        complaint_id: str,
        content_type: str = "image/jpeg",
    ) -> str:
        """Upload the blurred (privacy-safe) image."""
        return self.upload_image(image_bytes, complaint_id, "blurred", content_type)

    def get_image_url(self, complaint_id: str, prefix: str = "blurred") -> str:
        """Get the URL for an existing image."""
        return f"{settings.S3_ENDPOINT}/{settings.S3_BUCKET}/{prefix}/{complaint_id}.jpg"


# Singleton instance
storage_service = StorageService()

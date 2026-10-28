"""
Test fixtures for the ingestion API.

Provides:
- FastAPI test client with mocked dependencies
- Mock S3 (moto), mock Redis (fakeredis), mock DB
- Test image fixtures (valid JPEG, corrupt file)
- JWT_SECRET_KEY set before any app imports

Two client modes:
- `client`: Auth dependency overridden with admin user (for existing tests)
- `auth_client`: Real JWT auth (for test_auth.py RBAC tests)
"""

import io
import json
import os
import sys
from datetime import datetime, timezone
from typing import Generator
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from PIL import Image

# ── Set test JWT secret BEFORE importing any app modules ──
os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-unit-tests-only-not-production"

# Ensure app is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient


def create_test_image(
    width: int = 100,
    height: int = 100,
    color: str = "red",
    format: str = "JPEG",
) -> bytes:
    """Create a minimal valid image in memory."""
    img = Image.new("RGB", (width, height), color=color)
    buffer = io.BytesIO()
    img.save(buffer, format=format)
    buffer.seek(0)
    return buffer.read()


def create_large_image(size_mb: int = 25) -> bytes:
    """Create an image that exceeds the size limit."""
    img = Image.new("RGB", (4000, 4000), color="blue")
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=100)
    content = buffer.getvalue()
    padding = b"\x00" * (size_mb * 1024 * 1024 - len(content))
    return content + padding


@pytest.fixture
def valid_image_bytes() -> bytes:
    """A small, valid JPEG image."""
    return create_test_image()


@pytest.fixture
def valid_png_bytes() -> bytes:
    """A small, valid PNG image."""
    return create_test_image(format="PNG")


@pytest.fixture
def corrupt_image_bytes() -> bytes:
    """Bytes that are not a valid image."""
    return b"this is not an image file at all"


@pytest.fixture
def oversized_image_bytes() -> bytes:
    """An image exceeding MAX_IMAGE_SIZE_MB."""
    return create_large_image(25)


@pytest.fixture
def mock_db_service():
    """Mock database service that returns a fake complaint row."""
    mock = MagicMock()
    mock.insert_complaint.return_value = {
        "id": uuid4(),
        "status": "pending",
        "image_url": "http://localhost:9000/urbanpulse-images/blurred/test.jpg",
        "created_at": datetime.now(timezone.utc),
    }
    mock.connect.return_value = None
    mock.disconnect.return_value = None

    # Auth-related defaults
    mock.get_user_by_id.return_value = None
    mock.get_user_by_email.return_value = None
    mock.create_user.return_value = None
    mock.list_users.return_value = []
    mock.deactivate_user.return_value = False
    mock.bootstrap_admin.return_value = None

    return mock


@pytest.fixture
def mock_storage_service():
    """Mock S3 storage service."""
    mock = MagicMock()
    mock.upload_original.return_value = (
        "http://localhost:9000/urbanpulse-images/originals/test.jpg"
    )
    mock.upload_blurred.return_value = (
        "http://localhost:9000/urbanpulse-images/blurred/test.jpg"
    )
    mock.connect.return_value = None
    return mock


@pytest.fixture
def mock_queue_publisher():
    """Mock Redis queue publisher."""
    mock = MagicMock()
    mock.publish_detection_job.return_value = True
    mock.connect.return_value = None
    mock.disconnect.return_value = None
    return mock


@pytest.fixture
def mock_blur_service():
    """Mock blur service that returns input unchanged."""
    mock = MagicMock()
    mock.blur_image.side_effect = lambda x: x  # Pass-through
    return mock


# ─── Default mock superuser for auth override ────────────────

_DEFAULT_ADMIN_ID = str(uuid4())


class _SuperUserPayload:
    """
    A mock user payload with administrator role for test auth bypass.
    """
    def __init__(self):
        self.id = _DEFAULT_ADMIN_ID
        self.email = "testadmin@urbanpulse.test"
        self.name = "Test Admin"
        self.department_id = None
        self.role = "administrator"



def _make_patches(mock_db_service, mock_storage_service, mock_queue_publisher, mock_blur_service):
    """Return the common mock patches stack."""
    return [
        patch("app.routes.complaints.db_service", mock_db_service),
        patch("app.routes.complaints.storage_service", mock_storage_service),
        patch("app.routes.complaints.queue_publisher", mock_queue_publisher),
        patch("app.routes.complaints.blur_service", mock_blur_service),
        patch("app.routes.auth.db_service", mock_db_service),
        patch("app.services.database.db_service", mock_db_service),
        patch("app.services.storage.storage_service", mock_storage_service),
        patch("app.services.queue.queue_publisher", mock_queue_publisher),
    ]


@pytest.fixture
def client(
    mock_db_service,
    mock_storage_service,
    mock_queue_publisher,
    mock_blur_service,
) -> Generator:
    """
    FastAPI test client with auth OVERRIDDEN (admin user).

    All existing tests continue to work without auth headers.
    For auth-specific tests, use `auth_client` fixture instead.
    """
    from app.main import app as fastapi_app
    from app.auth import get_current_user, require_role, validate_department_access
    import app.routes.complaints
    import app.routes.auth

    patches = _make_patches(mock_db_service, mock_storage_service, mock_queue_publisher, mock_blur_service)

    # Override auth dependencies to return superuser that passes all role checks
    super_user = _SuperUserPayload()

    async def _mock_get_current_user():
        return super_user

    # Override get_current_user globally
    fastapi_app.dependency_overrides[get_current_user] = _mock_get_current_user

    def _collect_all_routes(router_or_app):
        collected = []
        for r in getattr(router_or_app, "routes", []):
            if hasattr(r, "original_router"):
                collected.extend(_collect_all_routes(r.original_router))
            else:
                collected.append(r)
        return collected

    # Scan all routes (including included routers) and override any require_role-generated _guard dependencies
    for route in _collect_all_routes(fastapi_app):
        if hasattr(route, "dependant"):
            deps_to_check = list(getattr(route.dependant, "dependencies", []) or [])
            deps_to_check.extend(getattr(route.dependant, "flat_dependants", []) or [])
            for dep in deps_to_check:
                call = getattr(dep, "call", None)
                if call and hasattr(call, "__qualname__") and "_guard" in call.__qualname__:
                    fastapi_app.dependency_overrides[call] = _mock_get_current_user


    # Patch validate_department_access to be a no-op
    def _mock_validate_dept_access(current_user, path_department_id):
        pass

    # Add patches for functions used in routes (for direct calls, not Depends)
    patches.extend([
        patch("app.routes.complaints.validate_department_access", _mock_validate_dept_access),
    ])

    for p in patches:
        p.start()

    try:
        with TestClient(fastapi_app, raise_server_exceptions=False) as test_client:
            yield test_client
    finally:
        for p in patches:
            p.stop()
        fastapi_app.dependency_overrides.clear()


@pytest.fixture
def auth_client(
    mock_db_service,
    mock_storage_service,
    mock_queue_publisher,
    mock_blur_service,
) -> Generator:
    """
    FastAPI test client with REAL JWT authentication.

    For auth/RBAC-specific tests. Requires Authorization header.
    """
    from app.main import app as fastapi_app
    import app.routes.complaints
    import app.routes.auth

    patches = _make_patches(mock_db_service, mock_storage_service, mock_queue_publisher, mock_blur_service)

    # Clear any dependency overrides
    fastapi_app.dependency_overrides.clear()

    for p in patches:
        p.start()

    try:
        with TestClient(fastapi_app, raise_server_exceptions=False) as test_client:
            yield test_client
    finally:
        for p in patches:
            p.stop()
        fastapi_app.dependency_overrides.clear()


# ─── Auth Token Helpers ──────────────────────────────────────

def _make_test_token(user_id=None, role="citizen", email="test@example.com",
                     department_id=None, name="Test User"):
    """Create a valid JWT token for test use."""
    from app.auth import create_access_token
    uid = str(user_id or uuid4())
    return create_access_token(
        user_id=uid, role=role, email=email,
        department_id=str(department_id) if department_id else None,
        name=name,
    ), uid


# Fixed test user IDs
_CITIZEN_ID = str(uuid4())
_ADMIN_ID = str(uuid4())
_OFFICER_ID = str(uuid4())
_DEPT_ID = str(uuid4())


def _mock_user_return(user_id, role, email, dept_id=None):
    return {
        "id": user_id,
        "name": "Test User",
        "email": email,
        "role": role,
        "department_id": dept_id,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@pytest.fixture
def citizen_auth(mock_db_service):
    """Returns (headers, user_id) for an authenticated citizen."""
    token, uid = _make_test_token(user_id=_CITIZEN_ID, role="citizen", email="citizen@test.com")
    mock_db_service.get_user_by_id.return_value = _mock_user_return(
        _CITIZEN_ID, "citizen", "citizen@test.com"
    )
    return {"Authorization": f"Bearer {token}"}, _CITIZEN_ID


@pytest.fixture
def admin_auth(mock_db_service):
    """Returns (headers, user_id) for an authenticated admin."""
    token, uid = _make_test_token(user_id=_ADMIN_ID, role="administrator", email="admin@test.com")
    mock_db_service.get_user_by_id.return_value = _mock_user_return(
        _ADMIN_ID, "administrator", "admin@test.com"
    )
    return {"Authorization": f"Bearer {token}"}, _ADMIN_ID


@pytest.fixture
def officer_auth(mock_db_service):
    """Returns (headers, user_id) for an authenticated department officer."""
    token, uid = _make_test_token(
        user_id=_OFFICER_ID, role="department_officer",
        email="officer@test.com", department_id=_DEPT_ID
    )
    mock_db_service.get_user_by_id.return_value = _mock_user_return(
        _OFFICER_ID, "department_officer", "officer@test.com", _DEPT_ID
    )
    return {"Authorization": f"Bearer {token}"}, _OFFICER_ID, _DEPT_ID

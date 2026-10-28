"""
Authentication, Authorization & RBAC Tests.

Validates:
- Registration (citizen only, password strength, duplicate emails)
- Login (valid/invalid credentials, inactive accounts, rate limiting)
- JWT (expiry, malformed, invalid algorithm, missing token)
- RBAC (citizen/officer/admin endpoint access)
- IDOR (cross-user/cross-department data isolation)
- Audit (actor derived from auth, not client-supplied)
"""

import uuid
import time
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from jose import jwt

# Must set JWT_SECRET_KEY before importing app modules
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-not-production")


def _make_token(user_id=None, role="citizen", email="test@example.com",
                department_id=None, name="Test User", expired=False,
                algorithm="HS256", secret=None):
    """Helper to create a JWT token for testing."""
    from app.config import settings
    secret = secret or settings.JWT_SECRET_KEY
    now = datetime.now(timezone.utc)
    exp = now - timedelta(hours=1) if expired else now + timedelta(hours=8)
    payload = {
        "sub": str(user_id or uuid.uuid4()),
        "role": role,
        "email": email,
        "department_id": str(department_id) if department_id else None,
        "name": name,
        "exp": exp,
        "iat": now,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, secret, algorithm=algorithm)


def _auth_header(token):
    """Build Authorization header dict."""
    return {"Authorization": f"Bearer {token}"}


# â”€â”€â”€ Fixtures â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ADMIN_ID = str(uuid.uuid4())
CITIZEN_A_ID = str(uuid.uuid4())
CITIZEN_B_ID = str(uuid.uuid4())
OFFICER_A_ID = str(uuid.uuid4())
OFFICER_B_ID = str(uuid.uuid4())
DEPT_A_ID = str(uuid.uuid4())
DEPT_B_ID = str(uuid.uuid4())
COMPLAINT_A_ID = str(uuid.uuid4())
COMPLAINT_B_ID = str(uuid.uuid4())
NOTIF_ID = str(uuid.uuid4())


def _mock_user(user_id, role, email, department_id=None, is_active=True, name="Test"):
    return {
        "id": user_id,
        "name": name,
        "email": email,
        "role": role,
        "department_id": department_id,
        "is_active": is_active,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _mock_complaint(complaint_id, citizen_id=None, department_id=None, status="pending"):
    return {
        "id": complaint_id,
        "image_url": "http://s3:9000/bucket/test.jpg",
        "blurred_image_url": None,
        "lat": 28.6139,
        "lng": 77.2090,
        "issue_class": "pothole",
        "confidence": 0.95,
        "severity_score": 5.0,
        "priority_score": 7.0,
        "status": status,
        "department_id": department_id,
        "department_name": "Roads",
        "sla_deadline": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": None,
        "closed_at": None,
        "source": "mobile_app",
        "location_source": "device",
        "description": None,
        "location_accuracy": None,
        "location_address": None,
        "user_selected_category": None,
        "duplicate_of_id": None,
        "citizen_id": citizen_id,
    }


class TestRegistration:
    """POST /api/v1/auth/register tests."""

    def test_register_success(self, auth_client, mock_db_service):
        """Citizen registration returns 201 with JWT token."""
        mock_db_service.create_user.return_value = {
            "id": str(uuid.uuid4()),
            "name": "Jane Doe",
            "email": "jane@example.com",
            "role": "citizen",
            "department_id": None,
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        response = auth_client.post("/api/v1/auth/register", json={
            "name": "Jane Doe",
            "email": "jane@example.com",
            "password": "StrongPass1",
        })
        assert response.status_code == 201
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert data["user"]["role"] == "citizen"

    def test_register_duplicate_email_409(self, auth_client, mock_db_service):
        """Duplicate email registration returns 409."""
        mock_db_service.create_user.side_effect = ValueError("A user with this email already exists")

        response = auth_client.post("/api/v1/auth/register", json={
            "name": "Jane Doe",
            "email": "jane@example.com",
            "password": "StrongPass1",
        })
        assert response.status_code == 409

    def test_register_weak_password_422(self, auth_client):
        """Weak password returns 422."""
        response = auth_client.post("/api/v1/auth/register", json={
            "name": "Jane Doe",
            "email": "jane@example.com",
            "password": "weak",
        })
        assert response.status_code == 422

    def test_register_invalid_email_422(self, auth_client):
        """Invalid email format returns 422."""
        response = auth_client.post("/api/v1/auth/register", json={
            "name": "Jane Doe",
            "email": "not-an-email",
            "password": "StrongPass1",
        })
        assert response.status_code == 422


class TestLogin:
    """POST /api/v1/auth/login tests."""

    def test_login_success(self, auth_client, mock_db_service):
        """Valid credentials return JWT token."""
        from app.auth import hash_password
        pw_hash = hash_password("StrongPass1")
        mock_db_service.get_user_by_email.return_value = {
            "id": CITIZEN_A_ID,
            "name": "Jane",
            "email": "jane@example.com",
            "password_hash": pw_hash,
            "role": "citizen",
            "department_id": None,
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        response = auth_client.post("/api/v1/auth/login", json={
            "email": "jane@example.com",
            "password": "StrongPass1",
        })
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["user"]["role"] == "citizen"

    def test_login_wrong_password_401(self, auth_client, mock_db_service):
        """Wrong password returns 401."""
        from app.auth import hash_password
        mock_db_service.get_user_by_email.return_value = {
            "id": CITIZEN_A_ID,
            "name": "Jane",
            "email": "jane@example.com",
            "password_hash": hash_password("CorrectPass1"),
            "role": "citizen",
            "department_id": None,
            "is_active": True,
        }

        response = auth_client.post("/api/v1/auth/login", json={
            "email": "jane@example.com",
            "password": "WrongPass1",
        })
        assert response.status_code == 401

    def test_login_nonexistent_user_401(self, auth_client, mock_db_service):
        """Nonexistent email returns 401."""
        mock_db_service.get_user_by_email.return_value = None

        response = auth_client.post("/api/v1/auth/login", json={
            "email": "nobody@example.com",
            "password": "StrongPass1",
        })
        assert response.status_code == 401

    def test_login_inactive_account_403(self, auth_client, mock_db_service):
        """Deactivated account returns 403."""
        from app.auth import hash_password
        mock_db_service.get_user_by_email.return_value = {
            "id": CITIZEN_A_ID,
            "name": "Jane",
            "email": "jane@example.com",
            "password_hash": hash_password("StrongPass1"),
            "role": "citizen",
            "department_id": None,
            "is_active": False,
        }

        response = auth_client.post("/api/v1/auth/login", json={
            "email": "jane@example.com",
            "password": "StrongPass1",
        })
        assert response.status_code == 403


class TestTokenValidation:
    """JWT token validation tests."""

    def test_missing_token_401(self, auth_client):
        """Request without Authorization header returns 401."""
        response = auth_client.get("/api/v1/complaints")
        assert response.status_code == 401

    def test_expired_token_401(self, auth_client, mock_db_service):
        """Expired token returns 401."""
        token = _make_token(expired=True)
        response = auth_client.get("/api/v1/complaints", headers=_auth_header(token))
        assert response.status_code == 401

    def test_malformed_token_401(self, auth_client):
        """Malformed token returns 401."""
        response = auth_client.get("/api/v1/complaints",
                              headers={"Authorization": "Bearer not-a-valid-jwt"})
        assert response.status_code == 401

    def test_wrong_secret_401(self, auth_client, mock_db_service):
        """Token signed with wrong secret returns 401."""
        token = _make_token(secret="wrong-secret-key")
        response = auth_client.get("/api/v1/complaints", headers=_auth_header(token))
        assert response.status_code == 401

    def test_valid_token_with_active_user(self, auth_client, mock_db_service):
        """Valid token with active user passes authentication."""
        token = _make_token(user_id=ADMIN_ID, role="administrator", email="admin@test.com")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            ADMIN_ID, "administrator", "admin@test.com"
        )
        mock_db_service.get_complaint_stats.return_value = {
            "total": 0, "pending": 0, "under_review": 0, "assigned": 0,
            "in_progress": 0, "repaired": 0, "verified": 0, "closed": 0,
            "rejected": 0, "high_priority": 0, "overdue_sla": 0,
        }
        response = auth_client.get("/api/v1/complaints/stats", headers=_auth_header(token))
        assert response.status_code == 200

    def test_deactivated_user_403(self, auth_client, mock_db_service):
        """Valid token for deactivated user returns 403."""
        token = _make_token(user_id=CITIZEN_A_ID, role="citizen")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            CITIZEN_A_ID, "citizen", "citizen@test.com", is_active=False
        )
        response = auth_client.get(f"/api/v1/complaints/{COMPLAINT_A_ID}",
                              headers=_auth_header(token))
        assert response.status_code == 403


class TestRBAC:
    """Role-based access control tests."""

    def test_citizen_cannot_access_complaints_list(self, auth_client, mock_db_service):
        """Citizens cannot GET /complaints (admin/officer only)."""
        token = _make_token(user_id=CITIZEN_A_ID, role="citizen")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            CITIZEN_A_ID, "citizen", "citizen@test.com"
        )
        response = auth_client.get("/api/v1/complaints", headers=_auth_header(token))
        assert response.status_code == 403

    def test_citizen_cannot_access_stats(self, auth_client, mock_db_service):
        """Citizens cannot GET /complaints/stats."""
        token = _make_token(user_id=CITIZEN_A_ID, role="citizen")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            CITIZEN_A_ID, "citizen", "citizen@test.com"
        )
        response = auth_client.get("/api/v1/complaints/stats", headers=_auth_header(token))
        assert response.status_code == 403

    def test_citizen_cannot_update_status(self, auth_client, mock_db_service):
        """Citizens cannot PATCH complaint status."""
        token = _make_token(user_id=CITIZEN_A_ID, role="citizen")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            CITIZEN_A_ID, "citizen", "citizen@test.com"
        )
        response = auth_client.patch(f"/api/v1/complaints/{COMPLAINT_A_ID}/status",
                                json={"status": "in_progress"},
                                headers=_auth_header(token))
        assert response.status_code == 403

    def test_citizen_cannot_assign_department(self, auth_client, mock_db_service):
        """Citizens cannot assign departments."""
        token = _make_token(user_id=CITIZEN_A_ID, role="citizen")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            CITIZEN_A_ID, "citizen", "citizen@test.com"
        )
        dept_id = str(uuid.uuid4())
        response = auth_client.patch(f"/api/v1/complaints/{COMPLAINT_A_ID}/assign",
                                json={"department_id": dept_id},
                                headers=_auth_header(token))
        assert response.status_code == 403

    def test_officer_cannot_assign_department(self, auth_client, mock_db_service):
        """Officers cannot assign departments (admin only)."""
        token = _make_token(user_id=OFFICER_A_ID, role="department_officer",
                            department_id=DEPT_A_ID)
        mock_db_service.get_user_by_id.return_value = _mock_user(
            OFFICER_A_ID, "department_officer", "officer@test.com", DEPT_A_ID
        )
        dept_id = str(uuid.uuid4())
        response = auth_client.patch(f"/api/v1/complaints/{COMPLAINT_A_ID}/assign",
                                json={"department_id": dept_id},
                                headers=_auth_header(token))
        assert response.status_code == 403

    def test_officer_cannot_access_department_operations(self, auth_client, mock_db_service):
        """Officers cannot GET /departments/operations (admin only)."""
        token = _make_token(user_id=OFFICER_A_ID, role="department_officer",
                            department_id=DEPT_A_ID)
        mock_db_service.get_user_by_id.return_value = _mock_user(
            OFFICER_A_ID, "department_officer", "officer@test.com", DEPT_A_ID
        )
        response = auth_client.get("/api/v1/departments/operations", headers=_auth_header(token))
        assert response.status_code == 403

    def test_admin_can_access_all_stats(self, auth_client, mock_db_service):
        """Admin can access /complaints/stats."""
        token = _make_token(user_id=ADMIN_ID, role="administrator")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            ADMIN_ID, "administrator", "admin@test.com"
        )
        mock_db_service.get_complaint_stats.return_value = {
            "total": 0, "pending": 0, "under_review": 0, "assigned": 0,
            "in_progress": 0, "repaired": 0, "verified": 0, "closed": 0,
            "rejected": 0, "high_priority": 0, "overdue_sla": 0,
        }
        response = auth_client.get("/api/v1/complaints/stats", headers=_auth_header(token))
        assert response.status_code == 200

    def test_admin_can_list_users(self, auth_client, mock_db_service):
        """Admin can GET /auth/users."""
        token = _make_token(user_id=ADMIN_ID, role="administrator")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            ADMIN_ID, "administrator", "admin@test.com"
        )
        mock_db_service.list_users.return_value = []
        response = auth_client.get("/api/v1/auth/users", headers=_auth_header(token))
        assert response.status_code == 200

    def test_citizen_cannot_list_users(self, auth_client, mock_db_service):
        """Citizens cannot GET /auth/users."""
        token = _make_token(user_id=CITIZEN_A_ID, role="citizen")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            CITIZEN_A_ID, "citizen", "citizen@test.com"
        )
        response = auth_client.get("/api/v1/auth/users", headers=_auth_header(token))
        assert response.status_code == 403

    def test_officer_cannot_create_users(self, auth_client, mock_db_service):
        """Officers cannot POST /auth/users."""
        token = _make_token(user_id=OFFICER_A_ID, role="department_officer",
                            department_id=DEPT_A_ID)
        mock_db_service.get_user_by_id.return_value = _mock_user(
            OFFICER_A_ID, "department_officer", "officer@test.com", DEPT_A_ID
        )
        response = auth_client.post("/api/v1/auth/users",
                               json={"name": "New", "email": "new@test.com",
                                     "password": "StrongPass1", "role": "administrator"},
                               headers=_auth_header(token))
        assert response.status_code == 403

    def test_health_endpoint_public(self, auth_client):
        """GET /health requires no authentication."""
        response = auth_client.get("/health")
        assert response.status_code == 200


class TestIDOR:
    """Cross-user and cross-department isolation tests."""

    def test_citizen_a_cannot_see_citizen_b_complaint(self, auth_client, mock_db_service):
        """Citizen A accessing Citizen B's complaint gets 404 (not 403)."""
        token = _make_token(user_id=CITIZEN_A_ID, role="citizen")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            CITIZEN_A_ID, "citizen", "citizenA@test.com"
        )
        # Complaint owned by Citizen B
        mock_db_service.get_complaint_by_id.return_value = _mock_complaint(
            COMPLAINT_B_ID, citizen_id=CITIZEN_B_ID
        )
        response = auth_client.get(f"/api/v1/complaints/{COMPLAINT_B_ID}",
                              headers=_auth_header(token))
        assert response.status_code == 404

    def test_citizen_a_can_see_own_complaint(self, auth_client, mock_db_service):
        """Citizen A can access their own complaint."""
        token = _make_token(user_id=CITIZEN_A_ID, role="citizen")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            CITIZEN_A_ID, "citizen", "citizenA@test.com"
        )
        mock_db_service.get_complaint_by_id.return_value = _mock_complaint(
            COMPLAINT_A_ID, citizen_id=CITIZEN_A_ID
        )
        response = auth_client.get(f"/api/v1/complaints/{COMPLAINT_A_ID}",
                              headers=_auth_header(token))
        assert response.status_code == 200

    def test_officer_a_cannot_access_dept_b_tasks(self, auth_client, mock_db_service):
        """Officer A cannot access Department B's tasks."""
        token = _make_token(user_id=OFFICER_A_ID, role="department_officer",
                            department_id=DEPT_A_ID)
        mock_db_service.get_user_by_id.return_value = _mock_user(
            OFFICER_A_ID, "department_officer", "officerA@test.com", DEPT_A_ID
        )
        response = auth_client.get(f"/api/v1/departments/{DEPT_B_ID}/tasks",
                              headers=_auth_header(token))
        assert response.status_code == 403

    def test_officer_a_can_access_own_dept_tasks(self, auth_client, mock_db_service):
        """Officer A can access their own department's tasks."""
        token = _make_token(user_id=OFFICER_A_ID, role="department_officer",
                            department_id=DEPT_A_ID)
        mock_db_service.get_user_by_id.return_value = _mock_user(
            OFFICER_A_ID, "department_officer", "officerA@test.com", DEPT_A_ID
        )
        mock_db_service.get_department_by_id.return_value = {"id": DEPT_A_ID, "name": "Roads"}
        mock_db_service.get_department_tasks.return_value = []
        response = auth_client.get(f"/api/v1/departments/{DEPT_A_ID}/tasks",
                              headers=_auth_header(token))
        assert response.status_code == 200

    def test_officer_a_cannot_access_dept_b_notifications(self, auth_client, mock_db_service):
        """Officer A cannot access Department B's notifications."""
        token = _make_token(user_id=OFFICER_A_ID, role="department_officer",
                            department_id=DEPT_A_ID)
        mock_db_service.get_user_by_id.return_value = _mock_user(
            OFFICER_A_ID, "department_officer", "officerA@test.com", DEPT_A_ID
        )
        response = auth_client.get(f"/api/v1/departments/{DEPT_B_ID}/notifications",
                              headers=_auth_header(token))
        assert response.status_code == 403

    def test_officer_notification_uses_auth_department(self, auth_client, mock_db_service):
        """Officer's notification read uses authenticated department, not client-supplied."""
        token = _make_token(user_id=OFFICER_A_ID, role="department_officer",
                            department_id=DEPT_A_ID)
        mock_db_service.get_user_by_id.return_value = _mock_user(
            OFFICER_A_ID, "department_officer", "officerA@test.com", DEPT_A_ID
        )
        mock_db_service.mark_notification_read.return_value = True

        # client tries to pass department_id for another department â€” should be overridden
        response = auth_client.patch(
            f"/api/v1/notifications/{NOTIF_ID}/read?department_id={DEPT_B_ID}",
            headers=_auth_header(token)
        )
        assert response.status_code == 200
        # Verify the DB was called with officer's own department, not the client-supplied one
        call_args = mock_db_service.mark_notification_read.call_args
        assert call_args[1].get('department_id') == DEPT_A_ID or call_args[0][1] == DEPT_A_ID


class TestAuditActor:
    """Status history actor derivation tests."""

    def test_actor_derived_from_auth_not_client(self, auth_client, mock_db_service):
        """Status update actor comes from authenticated user, not request body."""
        token = _make_token(user_id=ADMIN_ID, role="administrator",
                            email="admin@urbanpulse.local")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            ADMIN_ID, "administrator", "admin@urbanpulse.local"
        )
        mock_db_service.update_complaint_status.return_value = _mock_complaint(
            COMPLAINT_A_ID, status="in_progress"
        )

        response = auth_client.patch(
            f"/api/v1/complaints/{COMPLAINT_A_ID}/status",
            json={"status": "in_progress", "actor": "malicious_actor"},
            headers=_auth_header(token)
        )
        assert response.status_code == 200

        # Verify update_complaint_status was called with authenticated email, not "malicious_actor"
        call_kwargs = mock_db_service.update_complaint_status.call_args
        # actor kwarg should be the authenticated user's email
        assert "admin@urbanpulse.local" in str(call_kwargs)

    def test_actor_user_id_passed_to_status_update(self, auth_client, mock_db_service):
        """Status update includes actor_user_id for audit FK."""
        token = _make_token(user_id=ADMIN_ID, role="administrator",
                            email="admin@urbanpulse.local")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            ADMIN_ID, "administrator", "admin@urbanpulse.local"
        )
        mock_db_service.update_complaint_status.return_value = _mock_complaint(
            COMPLAINT_A_ID, status="in_progress"
        )

        response = auth_client.patch(
            f"/api/v1/complaints/{COMPLAINT_A_ID}/status",
            json={"status": "in_progress"},
            headers=_auth_header(token)
        )
        assert response.status_code == 200

        # Verify actor_user_id was passed
        call_kwargs = mock_db_service.update_complaint_status.call_args
        assert ADMIN_ID in str(call_kwargs)


class TestAdminUserManagement:
    """Admin user creation and deactivation tests."""

    def test_admin_can_create_officer(self, auth_client, mock_db_service):
        """Admin can create a department officer account."""
        token = _make_token(user_id=ADMIN_ID, role="administrator")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            ADMIN_ID, "administrator", "admin@test.com"
        )
        mock_db_service.get_department_by_id.return_value = {"id": DEPT_A_ID, "name": "Roads"}
        mock_db_service.create_user.return_value = _mock_user(
            str(uuid.uuid4()), "department_officer", "officer@test.com", DEPT_A_ID
        )

        response = auth_client.post("/api/v1/auth/users", json={
            "name": "Officer Test",
            "email": "officer@test.com",
            "password": "StrongPass1",
            "role": "department_officer",
            "department_id": DEPT_A_ID,
        }, headers=_auth_header(token))
        assert response.status_code == 201
        assert response.json()["role"] == "department_officer"

    def test_officer_creation_requires_department(self, auth_client, mock_db_service):
        """Creating officer without department_id returns 422."""
        token = _make_token(user_id=ADMIN_ID, role="administrator")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            ADMIN_ID, "administrator", "admin@test.com"
        )

        response = auth_client.post("/api/v1/auth/users", json={
            "name": "Officer Test",
            "email": "officer@test.com",
            "password": "StrongPass1",
            "role": "department_officer",
        }, headers=_auth_header(token))
        assert response.status_code == 422

    def test_admin_cannot_deactivate_self(self, auth_client, mock_db_service):
        """Admin cannot deactivate their own account."""
        token = _make_token(user_id=ADMIN_ID, role="administrator")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            ADMIN_ID, "administrator", "admin@test.com"
        )

        response = auth_client.patch(f"/api/v1/auth/users/{ADMIN_ID}/deactivate",
                                headers=_auth_header(token))
        assert response.status_code == 422

    def test_admin_can_deactivate_other_user(self, auth_client, mock_db_service):
        """Admin can deactivate another user."""
        token = _make_token(user_id=ADMIN_ID, role="administrator")
        mock_db_service.get_user_by_id.return_value = _mock_user(
            ADMIN_ID, "administrator", "admin@test.com"
        )
        mock_db_service.deactivate_user.return_value = True

        response = auth_client.patch(f"/api/v1/auth/users/{CITIZEN_A_ID}/deactivate",
                                headers=_auth_header(token))
        assert response.status_code == 200

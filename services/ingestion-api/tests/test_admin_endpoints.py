"""
Phase 4 Backend Admin API Tests.

Validates:
- GET /api/v1/complaints/stats returns live operational KPI statistics
- PATCH /api/v1/complaints/{id}/status updates lifecycle status
- PATCH /api/v1/complaints/{id}/status rejects invalid status with 422
- PATCH /api/v1/complaints/{id}/status returns 404 for nonexistent complaint
- PATCH /api/v1/complaints/{id}/assign assigns department by UUID
- PATCH /api/v1/complaints/{id}/assign rejects nonexistent department with 422
- PATCH /api/v1/complaints/{id}/assign returns 404 for nonexistent complaint
- GET /api/v1/departments returns registered municipal departments
- GET /api/v1/complaints supports filtering by issue_class, user_selected_category, min_priority, sla_state, search, and pagination
"""

import uuid
from unittest.mock import MagicMock, patch
import pytest


class TestAdminEndpoints:
    """Tests for Phase 4 Admin and Municipal Operations endpoints."""

    def test_get_complaint_stats(self, client):
        """GET /api/v1/complaints/stats returns live aggregate metrics."""
        mock_stats = {
            "total": 24,
            "pending": 5,
            "under_review": 3,
            "assigned": 8,
            "in_progress": 4,
            "repaired": 1,
            "verified": 1,
            "closed": 2,
            "rejected": 1,
            "high_priority": 6,
            "overdue_sla": 2,
        }
        with patch("app.routes.complaints.db_service.get_complaint_stats", return_value=mock_stats):
            response = client.get("/api/v1/complaints/stats")
            assert response.status_code == 200
            data = response.json()
            assert data["total"] == 24
            assert data["under_review"] == 3
            assert data["overdue_sla"] == 2
            assert data["high_priority"] == 6

    def test_update_status_success(self, client):
        """PATCH /api/v1/complaints/{id}/status successfully transitions status."""
        test_id = str(uuid.uuid4())
        mock_updated = {
            "id": test_id,
            "image_url": "http://s3:9000/bucket/test.jpg",
            "lat": 28.6139,
            "lng": 77.2090,
            "issue_class": "pothole",
            "confidence": 0.95,
            "status": "in_progress",
            "created_at": "2026-09-08T12:00:00Z",
            "updated_at": "2026-09-08T14:00:00Z",
        }
        with patch("app.routes.complaints.db_service.update_complaint_status", return_value=mock_updated):
            response = client.patch(
                f"/api/v1/complaints/{test_id}/status",
                json={"status": "in_progress"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "in_progress"

    def test_update_status_invalid_status_rejected_422(self, client):
        """PATCH /api/v1/complaints/{id}/status rejects invalid enum values with 422."""
        test_id = str(uuid.uuid4())
        with patch(
            "app.routes.complaints.db_service.update_complaint_status",
            side_effect=ValueError("Invalid status 'invalid_foo'"),
        ):
            response = client.patch(
                f"/api/v1/complaints/{test_id}/status",
                json={"status": "invalid_foo"},
            )
            assert response.status_code == 422
            assert "Invalid status" in response.json()["detail"]

    def test_update_status_not_found_returns_404(self, client):
        """PATCH /api/v1/complaints/{id}/status returns 404 if complaint not found."""
        missing_id = str(uuid.uuid4())
        with patch("app.routes.complaints.db_service.update_complaint_status", return_value=None):
            response = client.patch(
                f"/api/v1/complaints/{missing_id}/status",
                json={"status": "resolved"},
            )
            assert response.status_code == 404
            assert response.json()["detail"] == "Complaint not found"

    def test_assign_department_success(self, client):
        """PATCH /api/v1/complaints/{id}/assign assigns a department."""
        test_id = str(uuid.uuid4())
        dept_id = str(uuid.uuid4())
        mock_updated = {
            "id": test_id,
            "image_url": "http://s3:9000/bucket/test.jpg",
            "lat": 28.6139,
            "lng": 77.2090,
            "issue_class": "pothole",
            "confidence": 0.95,
            "status": "assigned",
            "department_id": dept_id,
            "department_name": "Roads & Infrastructure",
            "created_at": "2026-09-08T12:00:00Z",
        }
        with patch("app.routes.complaints.db_service.assign_department", return_value=mock_updated):
            response = client.patch(
                f"/api/v1/complaints/{test_id}/assign",
                json={"department_id": dept_id},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["department_name"] == "Roads & Infrastructure"
            assert data["department_id"] == dept_id

    def test_assign_department_invalid_dept_returns_422(self, client):
        """PATCH /api/v1/complaints/{id}/assign returns 422 if department does not exist."""
        test_id = str(uuid.uuid4())
        invalid_dept = str(uuid.uuid4())
        with patch(
            "app.routes.complaints.db_service.assign_department",
            side_effect=ValueError("Department not found"),
        ):
            response = client.patch(
                f"/api/v1/complaints/{test_id}/assign",
                json={"department_id": invalid_dept},
            )
            assert response.status_code == 422

    def test_list_departments(self, client):
        """GET /api/v1/departments returns registered municipal departments."""
        dept_id = str(uuid.uuid4())
        mock_depts = [
            {
                "id": dept_id,
                "name": "Roads & Infrastructure",
                "contact_email": "roads@city.gov",
                "contact_phone": "+91-11-23456789",
            }
        ]
        with patch("app.routes.complaints.db_service.list_departments", return_value=mock_depts):
            response = client.get("/api/v1/departments")
            assert response.status_code == 200
            data = response.json()
            assert len(data) == 1
            assert data[0]["name"] == "Roads & Infrastructure"

    def test_list_complaints_with_advanced_filters(self, client):
        """GET /api/v1/complaints passes all query filters to database service."""
        with patch("app.routes.complaints.db_service.list_complaints", return_value=[]) as mock_list:
            response = client.get(
                "/api/v1/complaints",
                params={
                    "status": "under_review",
                    "issue_class": "pothole",
                    "user_selected_category": "Road Damage",
                    "min_priority": 70,
                    "sla_state": "overdue",
                    "search": "Main Street",
                    "limit": 10,
                    "offset": 0,
                },
            )
            assert response.status_code == 200
            mock_list.assert_called_once_with(
                status="under_review",
                department_id=None,
                min_severity=None,
                issue_class="pothole",
                user_selected_category="Road Damage",
                min_priority=70.0,
                sla_state="overdue",
                search="Main Street",
                limit=10,
                offset=0,
            )

    def test_get_complaint_history_success(self, client):
        """GET /api/v1/complaints/{id}/history returns chronological status transitions."""
        test_id = str(uuid.uuid4())
        mock_complaint = {"id": test_id, "status": "in_progress"}
        mock_history = [
            {
                "id": str(uuid.uuid4()),
                "complaint_id": test_id,
                "previous_status": None,
                "new_status": "pending",
                "changed_at": "2026-09-08T10:00:00Z",
                "actor": "citizen_submission",
                "notes": "Initial complaint submission",
            },
            {
                "id": str(uuid.uuid4()),
                "complaint_id": test_id,
                "previous_status": "pending",
                "new_status": "assigned",
                "changed_at": "2026-09-08T11:00:00Z",
                "actor": "admin_assignment",
                "notes": "Department assigned: Roads",
            },
            {
                "id": str(uuid.uuid4()),
                "complaint_id": test_id,
                "previous_status": "assigned",
                "new_status": "in_progress",
                "changed_at": "2026-09-08T12:00:00Z",
                "actor": "admin_operator",
                "notes": "Work crew dispatched",
            },
        ]
        with patch("app.routes.complaints.db_service.get_complaint_by_id", return_value=mock_complaint), \
             patch("app.routes.complaints.db_service.get_status_history", return_value=mock_history):
            response = client.get(f"/api/v1/complaints/{test_id}/history")
            assert response.status_code == 200
            data = response.json()
            assert len(data) == 3
            assert data[0]["new_status"] == "pending"
            assert data[1]["previous_status"] == "pending"
            assert data[1]["new_status"] == "assigned"
            assert data[2]["new_status"] == "in_progress"
            assert data[2]["actor"] == "admin_operator"

    def test_get_complaint_history_not_found_returns_404(self, client):
        """GET /api/v1/complaints/{id}/history returns 404 for nonexistent complaint."""
        missing_id = str(uuid.uuid4())
        with patch("app.routes.complaints.db_service.get_complaint_by_id", return_value=None):
            response = client.get(f"/api/v1/complaints/{missing_id}/history")
            assert response.status_code == 404
            assert response.json()["detail"] == "Complaint not found"

    def test_status_transition_invalid_rejected_422(self, client):
        """PATCH /api/v1/complaints/{id}/status rejects disallowed lifecycle transitions with 422."""
        test_id = str(uuid.uuid4())
        with patch(
            "app.routes.complaints.db_service.update_complaint_status",
            side_effect=ValueError("Invalid status transition from 'pending' to 'closed'. Permitted transitions: ['assigned', 'in_progress', 'rejected', 'under_review']"),
        ):
            response = client.patch(
                f"/api/v1/complaints/{test_id}/status",
                json={"status": "closed"},
            )
            assert response.status_code == 422
            assert "Invalid status transition" in response.json()["detail"]

    def test_status_update_with_actor_and_notes(self, client):
        """PATCH /api/v1/complaints/{id}/status uses auth-derived actor (ignores client-supplied)."""
        test_id = str(uuid.uuid4())
        mock_updated = {
            "id": test_id,
            "image_url": "http://s3:9000/bucket/test.jpg",
            "lat": 28.6139,
            "lng": 77.2090,
            "issue_class": "pothole",
            "confidence": 0.95,
            "status": "assigned",
            "created_at": "2026-09-08T12:00:00Z",
            "updated_at": "2026-09-08T14:00:00Z",
        }
        with patch("app.routes.complaints.db_service.update_complaint_status", return_value=mock_updated) as mock_update:
            response = client.patch(
                f"/api/v1/complaints/{test_id}/status",
                json={
                    "status": "assigned",
                    "actor": "zone_3_supervisor",  # client-supplied — should be IGNORED
                    "notes": "Escalated to engineering crew",
                },
            )
            assert response.status_code == 200
            # Actor must come from authenticated user, NOT from client request
            call_args = mock_update.call_args
            assert call_args[1]["actor"] == "testadmin@urbanpulse.test"
            assert call_args[1]["notes"] == "Escalated to engineering crew"
            assert "actor_user_id" in call_args[1]  # Must include audit FK

    def test_list_complaints_invalid_filter_rejected_422(self, client):
        """GET /api/v1/complaints rejects invalid enum filter with 422."""
        with patch(
            "app.routes.complaints.db_service.list_complaints",
            side_effect=ValueError("Invalid status 'unknown_status'"),
        ):
            response = client.get("/api/v1/complaints", params={"status": "unknown_status"})
            assert response.status_code == 422
            assert "Invalid status" in response.json()["detail"]

    def test_post_assign_department_alias(self, client):
        """POST /api/v1/complaints/{id}/assign works as an alias for PATCH."""
        test_id = str(uuid.uuid4())
        dept_id = str(uuid.uuid4())
        mock_updated = {
            "id": test_id,
            "image_url": "http://s3:9000/bucket/test.jpg",
            "lat": 28.6139,
            "lng": 77.2090,
            "issue_class": "pothole",
            "confidence": 0.95,
            "status": "assigned",
            "department_id": dept_id,
            "department_name": "Civil Works",
            "created_at": "2026-09-08T12:00:00Z",
        }
        with patch("app.routes.complaints.db_service.assign_department", return_value=mock_updated):
            response = client.post(
                f"/api/v1/complaints/{test_id}/assign",
                json={"department_id": dept_id},
            )
            assert response.status_code == 200
            assert response.json()["department_name"] == "Civil Works"

    def test_invalid_uuid_rejected_422(self, client):
        """Status and assignment endpoints reject invalid UUIDs with 422."""
        res1 = client.patch("/api/v1/complaints/not-a-uuid/status", json={"status": "in_progress"})
        assert res1.status_code == 422

        res2 = client.patch("/api/v1/complaints/not-a-uuid/assign", json={"department_id": str(uuid.uuid4())})
        assert res2.status_code == 422

    def test_oversized_notes_rejected_422(self, client):
        """Status endpoint rejects notes exceeding max_length=500 with 422."""
        test_id = str(uuid.uuid4())
        res = client.patch(
            f"/api/v1/complaints/{test_id}/status",
            json={"status": "in_progress", "notes": "x" * 501},
        )
        assert res.status_code == 422

    def test_get_department_operations_summary(self, client):
        """GET /api/v1/departments/operations returns aggregated operational metrics."""
        mock_summary = [
            {
                "id": str(uuid.uuid4()),
                "name": "Roads & Infrastructure",
                "active_tasks": 5,
                "new_assignments": 2,
                "overdue_tasks": 1,
                "recent_notifications": [],
            }
        ]
        with patch("app.routes.complaints.db_service.get_department_operations_summary", return_value=mock_summary):
            res = client.get("/api/v1/departments/operations")
            assert res.status_code == 200
            data = res.json()
            assert len(data) == 1
            assert data[0]["name"] == "Roads & Infrastructure"
            assert data[0]["active_tasks"] == 5

    def test_get_department_tasks(self, client):
        """GET /api/v1/departments/{id}/tasks returns complaints in department queue."""
        dept_id = str(uuid.uuid4())
        mock_dept = {"id": dept_id, "name": "Roads & Infrastructure"}
        mock_tasks = [
            {
                "id": str(uuid.uuid4()),
                "image_url": "http://s3/test.jpg",
                "lat": 28.61,
                "lng": 77.20,
                "issue_class": "pothole",
                "confidence": 0.9,
                "status": "assigned",
                "department_id": dept_id,
                "created_at": "2026-09-08T10:00:00Z",
            }
        ]
        with patch("app.routes.complaints.db_service.get_department_by_id", return_value=mock_dept), \
             patch("app.routes.complaints.db_service.get_department_tasks", return_value=mock_tasks) as mock_get:
            res = client.get(f"/api/v1/departments/{dept_id}/tasks", params={"status": "assigned"})
            assert res.status_code == 200
            assert len(res.json()) == 1
            mock_get.assert_called_once_with(dept_id, status_filter="assigned", limit=50, offset=0)

    def test_get_department_tasks_not_found(self, client):
        """GET /api/v1/departments/{id}/tasks returns 404 when department does not exist."""
        dept_id = str(uuid.uuid4())
        with patch("app.routes.complaints.db_service.get_department_by_id", return_value=None):
            res = client.get(f"/api/v1/departments/{dept_id}/tasks")
            assert res.status_code == 404
            assert "Department not found" in res.json()["detail"]

    def test_get_department_tasks_invalid_status_rejected(self, client):
        """GET /api/v1/departments/{id}/tasks rejects unknown status filter with 422."""
        dept_id = str(uuid.uuid4())
        res = client.get(f"/api/v1/departments/{dept_id}/tasks", params={"status": "invalid_xyz"})
        assert res.status_code == 422
        assert "Invalid status filter" in res.json()["detail"]

    def test_get_department_tasks_bounded_pagination(self, client):
        """GET /api/v1/departments/{id}/tasks enforces limit between 1-100 and non-negative offset."""
        dept_id = str(uuid.uuid4())
        # limit > 100
        res1 = client.get(f"/api/v1/departments/{dept_id}/tasks", params={"limit": 500})
        assert res1.status_code == 422
        # negative offset
        res2 = client.get(f"/api/v1/departments/{dept_id}/tasks", params={"offset": -5})
        assert res2.status_code == 422

    def test_get_department_notifications_not_found(self, client):
        """GET /api/v1/departments/{id}/notifications returns 404 for unknown department."""
        dept_id = str(uuid.uuid4())
        with patch("app.routes.complaints.db_service.get_department_by_id", return_value=None):
            res = client.get(f"/api/v1/departments/{dept_id}/notifications")
            assert res.status_code == 404
            assert "Department not found" in res.json()["detail"]

    def test_department_notification_read_acknowledgement(self, client):
        """PATCH /api/v1/notifications/{id}/read marks notification as read."""
        notif_id = str(uuid.uuid4())
        with patch("app.routes.complaints.db_service.mark_notification_read", return_value=True):
            res = client.patch(f"/api/v1/notifications/{notif_id}/read")
            assert res.status_code == 200
            assert res.json()["success"] is True

        with patch("app.routes.complaints.db_service.mark_notification_read", return_value=False):
            res_not_found = client.patch(f"/api/v1/notifications/{notif_id}/read")
            assert res_not_found.status_code == 404

    def test_municipal_lifecycle_state_machine_matrix(self):
        """Direct verification of VALID_STATUS_TRANSITIONS state machine rules."""
        from app.services.database import VALID_STATUS_TRANSITIONS

        # pending can only transition to under_review, assigned, rejected
        assert VALID_STATUS_TRANSITIONS["pending"] == {"under_review", "assigned", "rejected"}
        assert "closed" not in VALID_STATUS_TRANSITIONS["pending"]
        assert "in_progress" not in VALID_STATUS_TRANSITIONS["pending"]

        # assigned can only transition to in_progress, under_review, rejected (cannot skip directly to repaired)
        assert VALID_STATUS_TRANSITIONS["assigned"] == {"in_progress", "under_review", "rejected"}
        assert "repaired" not in VALID_STATUS_TRANSITIONS["assigned"]

        # in_progress can transition to repaired, under_review
        assert VALID_STATUS_TRANSITIONS["in_progress"] == {"repaired", "under_review"}

        # repaired can only transition to verified, in_progress (cannot skip verification to closed)
        assert VALID_STATUS_TRANSITIONS["repaired"] == {"verified", "in_progress"}

        # verified can transition to closed, in_progress
        assert VALID_STATUS_TRANSITIONS["verified"] == {"closed", "in_progress"}

        # closed can reopen to in_progress or under_review
        assert VALID_STATUS_TRANSITIONS["closed"] == {"in_progress", "under_review"}

        # rejected can only transition to under_review
        assert VALID_STATUS_TRANSITIONS["rejected"] == {"under_review"}



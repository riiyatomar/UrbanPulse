"""
Unit tests for the routing engine classification mappings.
"""

from app.services.engine import routing_engine


def test_load_routing_rules():
    """Verify routing weights are parsed correctly."""
    routing_engine.load_rules()
    assert "pothole" in routing_engine.rules["department_mappings"]
    assert "Roads & Infrastructure" in routing_engine.rules["supervisor_contacts"]


def test_routing_mappings():
    """
    Test routing of specific issue categories to correct department tags.
    """
    routing_engine.load_rules()

    # pothole -> Roads
    dept, contact = routing_engine.resolve_department("pothole", "ward_east", 8.0)
    assert dept == "Roads & Infrastructure"
    assert contact["name"] == "Supervisor Roads"

    # streetlight -> Electrical
    dept, contact = routing_engine.resolve_department("streetlight", "ward_east", 3.0)
    assert dept == "Electrical & Streetlights"

    # waterlogging -> Drainage
    dept, contact = routing_engine.resolve_department("waterlogging", "ward_west", 5.0)
    assert dept == "Drainage & Water"

    # tree -> Parks
    dept, contact = routing_engine.resolve_department("tree", "ward_east", 6.0)
    assert dept == "Parks & Environment"


def test_unknown_class_routing():
    """
    Verify unknown classes route to a fallback general department.
    """
    routing_engine.load_rules()
    dept, contact = routing_engine.resolve_department("unknown_class", "ward_east", 5.0)
    assert dept == "Roads & Infrastructure"  # fallback default


def test_process_routing_job_skips_rejected(mock_db, mock_queue):
    """Verify routing job skips processing when complaint status is rejected."""
    from unittest.mock import patch
    from app.main import process_routing_job

    mock_db.get_complaint.return_value = {
        "id": "rejected-complaint-uuid",
        "issue_class": "pothole",
        "severity_score": 8.0,
        "lat": 28.6139,
        "lng": 77.2090,
        "status": "rejected",
    }

    job = {"complaint_id": "rejected-complaint-uuid"}

    with patch("app.main.routing_db", mock_db), \
         patch("app.main.routing_queue", mock_queue):
        process_routing_job(job)

        mock_db.get_complaint.assert_called_once_with("rejected-complaint-uuid")
        mock_db.assign_routing_details.assert_not_called()
        mock_queue.publish_assigned_notification.assert_not_called()


def test_process_routing_job_skips_under_review(mock_db, mock_queue):
    """Verify routing job skips processing when complaint status is under_review."""
    from unittest.mock import patch
    from app.main import process_routing_job

    mock_db.get_complaint.return_value = {
        "id": "review-complaint-uuid",
        "issue_class": "pothole",
        "severity_score": 8.0,
        "lat": 28.6139,
        "lng": 77.2090,
        "status": "under_review",
    }

    job = {"complaint_id": "review-complaint-uuid"}

    with patch("app.main.routing_db", mock_db), \
         patch("app.main.routing_queue", mock_queue):
        process_routing_job(job)

        mock_db.get_complaint.assert_called_once_with("review-complaint-uuid")
        mock_db.assign_routing_details.assert_not_called()
        mock_queue.publish_assigned_notification.assert_not_called()



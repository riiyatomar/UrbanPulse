import json
import logging
from contextlib import contextmanager
from datetime import datetime
from typing import Optional
from uuid import UUID

import psycopg2
from psycopg2 import pool, extras
from fastapi import HTTPException

from app.config import settings

logger = logging.getLogger(__name__)

# Register UUID adapter for psycopg2
psycopg2.extras.register_uuid()

ALLOWED_STATUSES = {
    "pending",
    "under_review",
    "assigned",
    "in_progress",
    "repaired",
    "verified",
    "closed",
    "rejected",
}

ALLOWED_ISSUE_CLASSES = {
    "pothole",
    "streetlight",
    "manhole",
    "dead_animal",
    "tree",
    "damaged_public_property",
    "waterlogging",
    "mud_road",
    "erosion",
    "footpath_damage",
    "encroachment",
}

VALID_STATUS_TRANSITIONS = {
    "pending": {"under_review", "assigned", "rejected"},
    "under_review": {"assigned", "in_progress", "rejected"},
    "assigned": {"in_progress", "under_review", "rejected"},
    "in_progress": {"repaired", "under_review"},
    "repaired": {"verified", "in_progress"},
    "verified": {"closed", "in_progress"},
    "closed": {"in_progress", "under_review"},
    "rejected": {"under_review"},
}


class DatabaseService:
    """Manages PostgreSQL connection pool and complaint operations."""

    def __init__(self):
        self._pool: Optional[pool.ThreadedConnectionPool] = None

    def connect(self):
        """Initialize the connection pool."""
        try:
            self._pool = pool.ThreadedConnectionPool(
                minconn=settings.DB_POOL_MIN,
                maxconn=settings.DB_POOL_MAX,
                dsn=settings.DATABASE_URL,
            )
            logger.info("Database connection pool initialized")
        except Exception as e:
            logger.error(f"Failed to initialize database pool: {e}")
            raise

    def disconnect(self):
        """Close all connections in the pool."""
        if self._pool:
            self._pool.closeall()
            logger.info("Database connection pool closed")

    @contextmanager
    def get_connection(self):
        """Get a connection from the pool (context manager)."""
        conn = self._pool.getconn()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            self._pool.putconn(conn)

    def insert_complaint(
        self,
        image_url: str,
        blurred_image_url: Optional[str],
        lat: float,
        lng: float,
        source: str = "mobile_app",
        timestamp: Optional[datetime] = None,
        location_source: str = "device",
        description: Optional[str] = None,
        location_accuracy: Optional[float] = None,
        location_address: Optional[str] = None,
        user_selected_category: Optional[str] = None,
        citizen_id: Optional[str] = None,
    ) -> dict:
        """
        Insert a new complaint with status='pending'.

        Args:
            image_url: S3 URL of the original image
            blurred_image_url: S3 URL of the blurred image
            lat: GPS latitude
            lng: GPS longitude
            source: Submission source (mobile_app, cctv, drone)
            timestamp: Optional capture timestamp
            location_source: How location was determined (image_exif, device, manual)
            description: Optional citizen description
            location_accuracy: Optional sensor accuracy in meters
            location_address: Optional reverse-geocoded OSM address
            user_selected_category: Optional category reported by citizen

        Returns:
            dict with id, status, image_url, created_at
        """
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO complaints (
                        image_url, blurred_image_url, lat, lng,
                        issue_class, confidence, status, source, location_source,
                        description, location_accuracy, location_address, user_selected_category,
                        citizen_id, created_at
                    ) VALUES (
                        %s, %s, %s, %s,
                        'pothole', 0.0, 'pending', %s, %s,
                        %s, %s, %s, %s,
                        %s, COALESCE(%s, NOW())
                    )
                    RETURNING id, status, blurred_image_url, created_at
                    """,
                    (
                        image_url,
                        blurred_image_url,
                        lat,
                        lng,
                        source,
                        location_source,
                        description,
                        location_accuracy,
                        location_address,
                        user_selected_category,
                        citizen_id,
                        timestamp,
                    ),
                )
                row = cur.fetchone()
                # Record initial status in history
                actor_label = 'citizen_submission'
                cur.execute(
                    """
                    INSERT INTO complaint_status_history (
                        complaint_id, previous_status, new_status, changed_at, actor, actor_user_id, notes
                    ) VALUES (%s, NULL, 'pending', %s, %s, %s, 'Initial complaint submission')
                    """,
                    (row[0], row[3], actor_label, citizen_id),
                )
                return {
                    "id": row[0],
                    "status": row[1],
                    "image_url": row[2] or image_url,
                    "created_at": row[3],
                }

    def list_complaints(
        self,
        status: Optional[str] = None,
        department_id: Optional[str] = None,
        min_severity: Optional[float] = None,
        issue_class: Optional[str] = None,
        user_selected_category: Optional[str] = None,
        min_priority: Optional[float] = None,
        sla_state: Optional[str] = None,
        search: Optional[str] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> list[dict]:
        """
        Retrieve complaints from PostgreSQL with flexible filtering,
        search, and pagination for operational management.
        """
        query = """
            SELECT c.id, c.image_url, c.blurred_image_url, c.lat, c.lng,
                   c.issue_class, c.confidence, c.severity_score, c.priority_score,
                   c.status, c.department_id, d.name AS department_name,
                   c.sla_deadline, c.created_at, c.updated_at, c.closed_at,
                   c.source, c.location_source, c.description,
                   c.location_accuracy, c.location_address, c.user_selected_category,
                   c.duplicate_of_id
            FROM complaints c
            LEFT JOIN departments d ON c.department_id = d.id
        """
        where_clauses = []
        params = []

        if status:
            if status not in ALLOWED_STATUSES:
                raise ValueError(f"Invalid status '{status}'. Must be one of: {sorted(ALLOWED_STATUSES)}")
            where_clauses.append("c.status = %s::complaint_status")
            params.append(status)
        if department_id:
            where_clauses.append("c.department_id = %s::uuid")
            params.append(department_id)
        if min_severity is not None:
            where_clauses.append("c.severity_score >= %s")
            params.append(min_severity)
        if issue_class:
            if issue_class not in ALLOWED_ISSUE_CLASSES:
                raise ValueError(f"Invalid issue_class '{issue_class}'. Must be one of: {sorted(ALLOWED_ISSUE_CLASSES)}")
            where_clauses.append("c.issue_class = %s::issue_class")
            params.append(issue_class)
        if user_selected_category:
            where_clauses.append("c.user_selected_category = %s")
            params.append(user_selected_category)
        if min_priority is not None:
            where_clauses.append("c.priority_score >= %s")
            params.append(min_priority)
        if sla_state in ("overdue", "breached"):
            where_clauses.append("c.sla_deadline < NOW() AND c.status IN ('assigned', 'in_progress')")
        elif sla_state == "active":
            where_clauses.append("(c.sla_deadline >= NOW() OR c.sla_deadline IS NULL) AND c.status IN ('assigned', 'in_progress')")

        if search and search.strip():
            search_param = f"%{search.strip()}%"
            where_clauses.append(
                "(c.description ILIKE %s OR c.location_address ILIKE %s OR "
                "c.issue_class::text ILIKE %s OR c.user_selected_category ILIKE %s OR "
                "c.id::text ILIKE %s)"
            )
            params.extend([search_param, search_param, search_param, search_param, search_param])

        if where_clauses:
            query += " WHERE " + " AND ".join(where_clauses)

        query += " ORDER BY c.created_at DESC"

        if limit is not None:
            safe_limit = max(1, min(int(limit), 100))
            query += f" LIMIT {safe_limit}"
        if offset is not None:
            safe_offset = max(0, int(offset))
            query += f" OFFSET {safe_offset}"

        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(query, tuple(params))
                rows = cur.fetchall()
                results = []
                for row in rows:
                    results.append({
                        "id": str(row["id"]),
                        "image_url": row["image_url"],
                        "blurred_image_url": row["blurred_image_url"],
                        "lat": float(row["lat"]),
                        "lng": float(row["lng"]),
                        "issue_class": row["issue_class"],
                        "confidence": float(row["confidence"]) if row["confidence"] is not None else 0.0,
                        "severity_score": float(row["severity_score"]) if row["severity_score"] is not None else None,
                        "priority_score": float(row["priority_score"]) if row["priority_score"] is not None else None,
                        "status": row["status"],
                        "department_id": str(row["department_id"]) if row["department_id"] else None,
                        "department_name": row["department_name"],
                        "sla_deadline": row["sla_deadline"].isoformat() if row["sla_deadline"] else None,
                        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
                        "closed_at": row["closed_at"].isoformat() if row["closed_at"] else None,
                        "source": row["source"],
                        "location_source": row["location_source"],
                        "description": row["description"],
                        "location_accuracy": float(row["location_accuracy"]) if row["location_accuracy"] is not None else None,
                        "location_address": row["location_address"],
                        "user_selected_category": row["user_selected_category"],
                        "duplicate_of_id": str(row["duplicate_of_id"]) if row.get("duplicate_of_id") else None,
                    })
                return results

    def get_status_history(self, complaint_id: str) -> list[dict]:
        """
        Retrieve the immutable audit timeline of status transitions for a complaint.
        """
        query = """
            SELECT id, complaint_id, previous_status, new_status, changed_at, actor, notes
            FROM complaint_status_history
            WHERE complaint_id = %s::uuid
            ORDER BY changed_at ASC
        """
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(query, (complaint_id,))
                rows = cur.fetchall()
                results = []
                for row in rows:
                    results.append({
                        "id": str(row["id"]),
                        "complaint_id": str(row["complaint_id"]),
                        "previous_status": row["previous_status"],
                        "new_status": row["new_status"],
                        "changed_at": row["changed_at"].isoformat() if row["changed_at"] else None,
                        "actor": row["actor"],
                        "notes": row["notes"],
                    })
                return results

    def get_complaint_by_id(self, complaint_id: str) -> Optional[dict]:
        """
        Retrieve a single complaint by its UUID, joined with departments and status history.
        """
        query = """
            SELECT c.id, c.image_url, c.blurred_image_url, c.lat, c.lng,
                   c.issue_class, c.confidence, c.severity_score, c.priority_score,
                   c.status, c.department_id, d.name AS department_name,
                   c.sla_deadline, c.created_at, c.updated_at, c.closed_at,
                   c.source, c.location_source, c.description,
                   c.location_accuracy, c.location_address, c.user_selected_category,
                   c.duplicate_of_id, c.citizen_id
            FROM complaints c
            LEFT JOIN departments d ON c.department_id = d.id
            WHERE c.id = %s::uuid
        """
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(query, (complaint_id,))
                row = cur.fetchone()
                if not row:
                    return None
                
                # Fetch history for this complaint
                history = self.get_status_history(complaint_id)

                return {
                    "id": str(row["id"]),
                    "image_url": row["image_url"],
                    "blurred_image_url": row["blurred_image_url"],
                    "lat": float(row["lat"]),
                    "lng": float(row["lng"]),
                    "issue_class": row["issue_class"],
                    "confidence": float(row["confidence"]) if row["confidence"] is not None else 0.0,
                    "severity_score": float(row["severity_score"]) if row["severity_score"] is not None else None,
                    "priority_score": float(row["priority_score"]) if row["priority_score"] is not None else None,
                    "status": row["status"],
                    "department_id": str(row["department_id"]) if row["department_id"] else None,
                    "department_name": row["department_name"],
                    "sla_deadline": row["sla_deadline"].isoformat() if row["sla_deadline"] else None,
                    "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                    "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
                    "closed_at": row["closed_at"].isoformat() if row["closed_at"] else None,
                    "source": row["source"],
                    "location_source": row["location_source"],
                    "description": row["description"],
                    "location_accuracy": float(row["location_accuracy"]) if row["location_accuracy"] is not None else None,
                    "location_address": row["location_address"],
                    "user_selected_category": row["user_selected_category"],
                    "duplicate_of_id": str(row["duplicate_of_id"]) if row.get("duplicate_of_id") else None,
                    "citizen_id": str(row["citizen_id"]) if row.get("citizen_id") else None,
                    "status_history": history,
                }

    def update_complaint_status(
        self,
        complaint_id: str,
        status: str,
        actor: str = "admin_operator",
        notes: Optional[str] = None,
        actor_user_id: Optional[str] = None,
    ) -> Optional[dict]:
        """
        Update the lifecycle status of a complaint with state machine transition validation
        and immutable audit history logging.
        """
        if status not in ALLOWED_STATUSES:
            raise ValueError(f"Invalid status '{status}'. Must be one of: {sorted(ALLOWED_STATUSES)}")

        clean_actor = (actor or "admin_operator").strip()[:255]
        clean_notes = notes.strip()[:500] if (notes and isinstance(notes, str) and notes.strip()) else None

        with self.get_connection() as conn:
            with conn.cursor() as cur:
                # 1. Fetch current status with row-level locking for concurrency safety
                cur.execute("SELECT status FROM complaints WHERE id = %s::uuid FOR UPDATE", (complaint_id,))
                existing = cur.fetchone()
                if not existing:
                    return None
                current_status = existing[0]

                # If status is the same, no transition needed
                if current_status == status:
                    return self.get_complaint_by_id(complaint_id)

                # 2. Validate transition
                valid_next = VALID_STATUS_TRANSITIONS.get(current_status, set())
                if status not in valid_next:
                    raise ValueError(
                        f"Invalid status transition from '{current_status}' to '{status}'. "
                        f"Permitted transitions: {sorted(valid_next)}"
                    )

                # 3. Update complaint
                # If entering closed/rejected: closed_at = NOW()
                # If reopening from closed/rejected to active state: closed_at = NULL
                # Else: closed_at remains unchanged
                cur.execute(
                    """
                    UPDATE complaints
                    SET status = %s::complaint_status,
                        updated_at = NOW(),
                        closed_at = CASE
                            WHEN %s::complaint_status IN ('closed', 'rejected') THEN NOW()
                            WHEN %s::complaint_status IN ('closed', 'rejected')
                                 AND %s::complaint_status NOT IN ('closed', 'rejected') THEN NULL
                            ELSE closed_at
                        END
                    WHERE id = %s::uuid
                    RETURNING id
                    """,
                    (status, status, current_status, status, complaint_id),
                )

                # 4. Insert status history record
                cur.execute(
                    """
                    INSERT INTO complaint_status_history (
                        complaint_id, previous_status, new_status, changed_at, actor, actor_user_id, notes
                    ) VALUES (%s, %s::complaint_status, %s::complaint_status, NOW(), %s, %s, %s)
                    """,
                    (complaint_id, current_status, status, clean_actor, actor_user_id, clean_notes),
                )

        return self.get_complaint_by_id(complaint_id)

    def assign_department(
        self,
        complaint_id: str,
        department_id: str,
        actor: str = "admin_assignment",
    ) -> Optional[dict]:
        """
        Assign or reassign a complaint to a municipal department,
        transitioning pending/under_review to assigned and logging history.
        """
        clean_actor = (actor or "admin_assignment").strip()[:50]
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                # Verify department exists
                cur.execute("SELECT id FROM departments WHERE id = %s::uuid", (department_id,))
                if not cur.fetchone():
                    raise ValueError(f"Department with ID {department_id} not found")

                # Check complaint exists and lock row
                cur.execute("SELECT status, department_id FROM complaints WHERE id = %s::uuid FOR UPDATE", (complaint_id,))
                row = cur.fetchone()
                if not row:
                    return None
                current_status = row[0]
                previous_dept_id = row[1]

                # Prevent duplicate assignment to the exact same department
                if previous_dept_id and str(previous_dept_id) == str(department_id):
                    return self.get_complaint_by_id(complaint_id)

                new_status = "assigned" if current_status in ("pending", "under_review") else current_status

                cur.execute(
                    """
                    UPDATE complaints
                    SET department_id = %s::uuid,
                        updated_at = NOW(),
                        status = %s::complaint_status
                    WHERE id = %s::uuid
                    RETURNING id
                    """,
                    (department_id, new_status, complaint_id),
                )

                history_notes = f"Department assigned: {department_id}" if not previous_dept_id else f"Department reassigned from {previous_dept_id} to {department_id}"
                if new_status != current_status or previous_dept_id != department_id:
                    cur.execute(
                        """
                        INSERT INTO complaint_status_history (
                            complaint_id, previous_status, new_status, changed_at, actor, notes
                        ) VALUES (%s, %s::complaint_status, %s::complaint_status, NOW(), %s, %s)
                        """,
                        (complaint_id, current_status, new_status, clean_actor, history_notes),
                    )

                # Fetch department name and complaint issue details for authoritative notification
                cur.execute("SELECT name FROM departments WHERE id = %s::uuid", (department_id,))
                dept_name_row = cur.fetchone()
                dept_name = dept_name_row[0] if dept_name_row else "Municipal Department"

                cur.execute("SELECT issue_class, priority_score, location_address FROM complaints WHERE id = %s::uuid", (complaint_id,))
                c_details = cur.fetchone()
                issue_name = c_details[0].replace("_", " ").title() if c_details and c_details[0] else "Civic Incident"
                p_score = c_details[1] if c_details and c_details[1] is not None else 50.0
                loc_summary = c_details[2] if c_details and c_details[2] else "Location on Record"

                # If reassigned away from a previous department, notify previous department and mark stale alerts as read
                if previous_dept_id and str(previous_dept_id) != str(department_id):
                    cur.execute(
                        """
                        UPDATE department_notifications
                        SET read = TRUE
                        WHERE department_id = %s::uuid AND complaint_id = %s::uuid AND read = FALSE
                        """,
                        (previous_dept_id, complaint_id),
                    )
                    cur.execute(
                        """
                        INSERT INTO department_notifications (
                            department_id, complaint_id, type, title, message, priority, read, created_at
                        ) VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, FALSE, NOW())
                        """,
                        (
                            previous_dept_id,
                            complaint_id,
                            "reassignment",
                            f"Task Reassigned: {issue_name}",
                            f"Complaint #{str(complaint_id)[:8]} ({issue_name}) was transferred to {dept_name}.",
                            "normal",
                        ),
                    )

                notif_priority = "high" if p_score >= 70 else "normal"
                cur.execute(
                    """
                    INSERT INTO department_notifications (
                        department_id, complaint_id, type, title, message, priority, read, created_at
                    ) VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, FALSE, NOW())
                    """,
                    (
                        department_id,
                        complaint_id,
                        "assignment",
                        f"New Assignment: {issue_name}",
                        f"Complaint #{str(complaint_id)[:8]} ({issue_name}) assigned to {dept_name}. Location: {loc_summary}. Priority: {p_score:.0f}/100.",
                        notif_priority,
                    ),
                )

        return self.get_complaint_by_id(complaint_id)

    def list_departments(self) -> list[dict]:
        """
        List all registered municipal departments.
        """
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, name, issue_types, contact_info
                    FROM departments
                    ORDER BY name ASC
                    """
                )
                rows = cur.fetchall()
                results = []
                for row in rows:
                    c_info = row.get("contact_info") or {}
                    if isinstance(c_info, str):
                        try:
                            c_info = json.loads(c_info)
                        except Exception:
                            c_info = {}
                    results.append({
                        "id": str(row["id"]),
                        "name": row["name"],
                        "contact_email": c_info.get("email"),
                        "contact_phone": c_info.get("phone"),
                    })
                return results

    def get_department_by_id(self, department_id: str) -> Optional[dict]:
        """
        Fetch single municipal department by UUID.
        """
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(
                    "SELECT id, name, issue_types, contact_info FROM departments WHERE id = %s::uuid",
                    (department_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                c_info = row.get("contact_info") or {}
                if isinstance(c_info, str):
                    try:
                        c_info = json.loads(c_info)
                    except Exception:
                        c_info = {}
                return {
                    "id": str(row["id"]),
                    "name": row["name"],
                    "contact_email": c_info.get("email"),
                    "contact_phone": c_info.get("phone"),
                }

    def get_complaint_stats(self) -> dict:
        """
        Derive authoritative KPI summary metrics directly from PostgreSQL.
        """
        query = """
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
                COUNT(*) FILTER (WHERE status = 'under_review')::int AS under_review,
                COUNT(*) FILTER (WHERE status = 'assigned')::int AS assigned,
                COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
                COUNT(*) FILTER (WHERE status = 'repaired')::int AS repaired,
                COUNT(*) FILTER (WHERE status = 'verified')::int AS verified,
                COUNT(*) FILTER (WHERE status = 'closed')::int AS closed,
                COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
                COUNT(*) FILTER (WHERE priority_score >= 70)::int AS high_priority,
                COUNT(*) FILTER (WHERE sla_deadline < NOW() AND status IN ('assigned', 'in_progress'))::int AS overdue_sla
            FROM complaints
        """
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(query)
                row = cur.fetchone()
                return {
                    "total": row["total"] or 0,
                    "pending": row["pending"] or 0,
                    "under_review": row["under_review"] or 0,
                    "assigned": row["assigned"] or 0,
                    "in_progress": row["in_progress"] or 0,
                    "repaired": row["repaired"] or 0,
                    "verified": row["verified"] or 0,
                    "closed": row["closed"] or 0,
                    "rejected": row["rejected"] or 0,
                    "high_priority": row["high_priority"] or 0,
                    "overdue_sla": row["overdue_sla"] or 0,
                }

    def _row_to_complaint(self, row) -> dict:
        """Helper to serialize database row to complaint dict."""
        return {
            "id": str(row["id"]),
            "image_url": row["image_url"],
            "blurred_image_url": row["blurred_image_url"],
            "lat": float(row["lat"]),
            "lng": float(row["lng"]),
            "issue_class": row["issue_class"],
            "confidence": float(row["confidence"]) if row["confidence"] is not None else 0.0,
            "severity_score": float(row["severity_score"]) if row["severity_score"] is not None else None,
            "priority_score": float(row["priority_score"]) if row["priority_score"] is not None else None,
            "status": row["status"],
            "department_id": str(row["department_id"]) if row["department_id"] else None,
            "department_name": row["department_name"],
            "sla_deadline": row["sla_deadline"].isoformat() if row["sla_deadline"] else None,
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
            "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
            "closed_at": row["closed_at"].isoformat() if row["closed_at"] else None,
            "source": row["source"],
            "location_source": row["location_source"],
            "description": row["description"],
            "location_accuracy": float(row["location_accuracy"]) if row["location_accuracy"] is not None else None,
            "location_address": row["location_address"],
            "user_selected_category": row["user_selected_category"],
            "duplicate_of_id": str(row["duplicate_of_id"]) if row.get("duplicate_of_id") else None,
        }

    def get_department_tasks(self, department_id: str, status_filter: Optional[str] = None, limit: int = 50, offset: int = 0) -> list[dict]:
        """
        Fetch task work queue for a specific municipal department.
        """
        clean_limit = max(1, min(limit, 100))
        clean_offset = max(0, offset)

        query = """
            SELECT
                c.id, c.image_url, c.blurred_image_url,
                c.lat, c.lng, c.issue_class, c.confidence,
                c.severity_score, c.priority_score, c.status,
                c.department_id, d.name AS department_name,
                c.sla_deadline, c.created_at, c.updated_at, c.closed_at,
                c.source, c.location_source, c.description,
                c.location_accuracy, c.location_address,
                c.user_selected_category, c.duplicate_of_id
            FROM complaints c
            LEFT JOIN departments d ON c.department_id = d.id
            WHERE c.department_id = %s::uuid
        """
        params = [department_id]

        if status_filter and status_filter.lower() != "all":
            if status_filter.lower() == "overdue":
                query += " AND c.sla_deadline < NOW() AND c.status IN ('assigned', 'in_progress')"
            else:
                query += " AND c.status = %s::complaint_status"
                params.append(status_filter)

        query += " ORDER BY c.priority_score DESC NULLS LAST, c.created_at DESC LIMIT %s OFFSET %s"
        params.extend([clean_limit, clean_offset])

        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(query, tuple(params))
                rows = cur.fetchall()
                return [self._row_to_complaint(r) for r in rows]

    def create_department_notification(
        self,
        department_id: str,
        complaint_id: str,
        notif_type: str,
        title: str,
        message: str,
        priority: str = "normal",
    ) -> dict:
        """
        Persist an authoritative department notification record.
        """
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO department_notifications (
                        department_id, complaint_id, type, title, message, priority, read, created_at
                    ) VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, FALSE, NOW())
                    RETURNING id, department_id, complaint_id, type, title, message, priority, read, created_at
                    """,
                    (department_id, complaint_id, notif_type[:50], title[:200], message, priority[:20]),
                )
                row = cur.fetchone()
                return {
                    "id": str(row["id"]),
                    "department_id": str(row["department_id"]),
                    "complaint_id": str(row["complaint_id"]),
                    "type": row["type"],
                    "title": row["title"],
                    "message": row["message"],
                    "priority": row["priority"],
                    "read": bool(row["read"]),
                    "created_at": row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
                }

    def get_department_notifications(self, department_id: str, limit: int = 20) -> list[dict]:
        """
        Retrieve recent notifications for a municipal department.
        """
        clean_limit = max(1, min(limit, 50))
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, department_id, complaint_id, type, title, message, priority, read, created_at
                    FROM department_notifications
                    WHERE department_id = %s::uuid
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    (department_id, clean_limit),
                )
                rows = cur.fetchall()
                return [
                    {
                        "id": str(r["id"]),
                        "department_id": str(r["department_id"]),
                        "complaint_id": str(r["complaint_id"]),
                        "type": r["type"],
                        "title": r["title"],
                        "message": r["message"],
                        "priority": r["priority"],
                        "read": bool(r["read"]),
                        "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
                    }
                    for r in rows
                ]

    def mark_notification_read(self, notification_id: str, department_id: str = None) -> bool:
        """
        Mark a notification as read.
        If department_id is provided, validates the notification belongs to that department
        before marking it read (prevents cross-department IDOR).
        """
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                if department_id:
                    cur.execute(
                        "UPDATE department_notifications SET read = TRUE WHERE id = %s::uuid AND department_id = %s::uuid RETURNING id",
                        (notification_id, department_id),
                    )
                else:
                    cur.execute(
                        "UPDATE department_notifications SET read = TRUE WHERE id = %s::uuid RETURNING id",
                        (notification_id,),
                    )
                return bool(cur.fetchone())

    def get_department_operations_summary(self) -> list[dict]:
        """
        Aggregate operational workload across all registered municipal departments.
        """
        depts = self.list_departments()
        summary = []
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                for dept in depts:
                    dept_id = dept["id"]
                    cur.execute(
                        """
                        SELECT
                            COUNT(*) FILTER (WHERE status IN ('assigned', 'in_progress'))::int AS active_tasks,
                            COUNT(*) FILTER (WHERE status = 'assigned')::int AS new_assignments,
                            COUNT(*) FILTER (WHERE sla_deadline < NOW() AND status IN ('assigned', 'in_progress'))::int AS overdue_tasks
                        FROM complaints
                        WHERE department_id = %s::uuid
                        """,
                        (dept_id,),
                    )
                    counts = cur.fetchone()
                    recent_notifs = self.get_department_notifications(dept_id, limit=3)
                    summary.append({
                        "id": dept_id,
                        "name": dept["name"],
                        "active_tasks": counts["active_tasks"] or 0,
                        "new_assignments": counts["new_assignments"] or 0,
                        "overdue_tasks": counts["overdue_tasks"] or 0,
                        "recent_notifications": recent_notifs,
                    })
        return summary

    # ─── User Management ──────────────────────────────────────

    def create_user(
        self,
        name: str,
        email: str,
        password_hash: str,
        role: str = "citizen",
        department_id: Optional[str] = None,
    ) -> dict:
        """Create a new user account. Returns the created user (without password_hash)."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                try:
                    cur.execute(
                        """
                        INSERT INTO users (name, email, password_hash, role, department_id)
                        VALUES (%s, LOWER(%s), %s, %s::user_role, %s)
                        RETURNING id, name, email, role, department_id, is_active, created_at
                        """,
                        (name, email, password_hash, role, department_id),
                    )
                    row = cur.fetchone()
                    return {
                        "id": str(row["id"]),
                        "name": row["name"],
                        "email": row["email"],
                        "role": row["role"],
                        "department_id": str(row["department_id"]) if row["department_id"] else None,
                        "is_active": row["is_active"],
                        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                    }
                except psycopg2.errors.UniqueViolation:
                    raise ValueError("A user with this email already exists")
                except psycopg2.errors.CheckViolation as e:
                    raise ValueError(f"Constraint violation: {e}")

    def get_user_by_email(self, email: str) -> Optional[dict]:
        """Fetch a user by email (case-insensitive). Includes password_hash for verification."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, name, email, password_hash, role, department_id, is_active, created_at
                    FROM users
                    WHERE LOWER(email) = LOWER(%s)
                    """,
                    (email,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return {
                    "id": str(row["id"]),
                    "name": row["name"],
                    "email": row["email"],
                    "password_hash": row["password_hash"],
                    "role": row["role"],
                    "department_id": str(row["department_id"]) if row["department_id"] else None,
                    "is_active": row["is_active"],
                    "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                }

    def get_user_by_id(self, user_id: str) -> Optional[dict]:
        """Fetch a user by UUID. Does NOT include password_hash."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, name, email, role, department_id, is_active, created_at
                    FROM users
                    WHERE id = %s::uuid
                    """,
                    (user_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return {
                    "id": str(row["id"]),
                    "name": row["name"],
                    "email": row["email"],
                    "role": row["role"],
                    "department_id": str(row["department_id"]) if row["department_id"] else None,
                    "is_active": row["is_active"],
                    "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                }

    def list_users(self) -> list:
        """List all users (without password hashes). Admin use only."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, name, email, role, department_id, is_active, created_at
                    FROM users
                    ORDER BY created_at DESC
                    """
                )
                return [
                    {
                        "id": str(row["id"]),
                        "name": row["name"],
                        "email": row["email"],
                        "role": row["role"],
                        "department_id": str(row["department_id"]) if row["department_id"] else None,
                        "is_active": row["is_active"],
                        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                    }
                    for row in cur.fetchall()
                ]

    def deactivate_user(self, user_id: str) -> bool:
        """Deactivate a user account. Returns True if user was found and deactivated."""
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE users SET is_active = FALSE WHERE id = %s::uuid AND is_active = TRUE RETURNING id",
                    (user_id,),
                )
                return cur.fetchone() is not None

    def bootstrap_admin(self, name: str, email: str, password_hash: str) -> Optional[dict]:
        """Create the bootstrap admin if no admin exists. Returns the admin user or None if one exists."""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                # Check if any admin already exists
                cur.execute("SELECT id FROM users WHERE role = 'administrator' LIMIT 1")
                if cur.fetchone():
                    return None  # Admin already exists, skip bootstrap
                try:
                    cur.execute(
                        """
                        INSERT INTO users (name, email, password_hash, role)
                        VALUES (%s, LOWER(%s), %s, 'administrator')
                        RETURNING id, name, email, role, is_active, created_at
                        """,
                        (name, email, password_hash),
                    )
                    row = cur.fetchone()
                    return {
                        "id": str(row["id"]),
                        "name": row["name"],
                        "email": row["email"],
                        "role": row["role"],
                        "is_active": row["is_active"],
                    }
                except psycopg2.errors.UniqueViolation:
                    return None  # Email already taken


# Singleton instance
db_service = DatabaseService()


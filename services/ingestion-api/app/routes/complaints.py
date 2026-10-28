"""
Complaint ingestion and management endpoints with RBAC authorization.

POST /complaints — Submit complaint (authenticated citizen only)
GET  /complaints — List complaints (admin/officer scoped)
GET  /complaints/stats — KPIs (admin/officer)
GET  /complaints/{id} — Complaint details (ownership-enforced)
GET  /complaints/{id}/history — Status history (ownership-enforced)
PATCH /complaints/{id}/status — Update status (admin/officer, actor from auth)
PATCH /complaints/{id}/assign — Assign department (admin only)
GET  /departments — List departments (admin/officer)
GET  /departments/operations — Operations overview (admin only)
GET  /departments/{id}/tasks — Department work queue (dept-scoped)
GET  /departments/{id}/notifications — Department notifications (dept-scoped)
PATCH /notifications/{id}/read — Mark notification read (dept-scoped)

Authorization rules:
- Citizen: can submit complaints, view own complaints only
- Department Officer: can view/manage own department's complaints/tasks/notifications
- Administrator: full access to all operations
- Actor on status history: derived from authenticated user, never client-supplied
"""

import io
import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS

from app.auth import (
    UserPayload,
    get_current_user,
    require_role,
    require_any_role,
    validate_department_access,
)
from app.config import settings
from app.models import (
    ComplaintMetadata,
    ComplaintResponse,
    DetailedComplaintResponse,
    UpdateStatusRequest,
    AssignDepartmentRequest,
    DepartmentResponse,
    ComplaintStatsResponse,
    StatusHistoryItem,
    DepartmentNotificationResponse,
    DepartmentOperationsSummary,
)
from app.services.blur import blur_service
from app.services.database import db_service
from app.services.queue import queue_publisher
from app.services.storage import storage_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["complaints"])


def _extract_exif_gps(image: Image.Image) -> dict:
    """
    Extract GPS coordinates and timestamp from image EXIF data.

    Returns dict with optional keys: lat, lng, timestamp
    """
    result = {}
    try:
        exif_data = image._getexif()
        if not exif_data:
            return result

        # Extract timestamp
        for tag_id, value in exif_data.items():
            tag = TAGS.get(tag_id, tag_id)
            if tag == "DateTimeOriginal":
                result["timestamp"] = value

        # Extract GPS info
        gps_info = {}
        for tag_id, value in exif_data.items():
            tag = TAGS.get(tag_id, tag_id)
            if tag == "GPSInfo":
                for gps_tag_id, gps_value in value.items():
                    gps_tag = GPSTAGS.get(gps_tag_id, gps_tag_id)
                    gps_info[gps_tag] = gps_value

        if "GPSLatitude" in gps_info and "GPSLongitude" in gps_info:
            lat = _convert_gps_to_decimal(
                gps_info["GPSLatitude"],
                gps_info.get("GPSLatitudeRef", "N"),
            )
            lng = _convert_gps_to_decimal(
                gps_info["GPSLongitude"],
                gps_info.get("GPSLongitudeRef", "E"),
            )
            result["lat"] = lat
            result["lng"] = lng

    except Exception as e:
        logger.debug(f"EXIF extraction failed: {e}")

    return result


def _convert_gps_to_decimal(dms_tuple, ref: str) -> float:
    """Convert EXIF GPS DMS (degrees, minutes, seconds) to decimal."""
    degrees = float(dms_tuple[0])
    minutes = float(dms_tuple[1])
    seconds = float(dms_tuple[2])
    decimal = degrees + minutes / 60.0 + seconds / 3600.0
    if ref in ("S", "W"):
        decimal = -decimal
    return decimal


def _validate_image(image_bytes: bytes, content_type: str) -> Image.Image:
    """
    Validate that the uploaded file is a valid image.

    Raises HTTPException if:
    - Content type not allowed
    - File is corrupt / not a valid image
    - File exceeds size limit
    """
    # Check size
    max_bytes = settings.MAX_IMAGE_SIZE_MB * 1024 * 1024
    if len(image_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Image exceeds maximum size of {settings.MAX_IMAGE_SIZE_MB}MB",
        )

    # Check content type
    if content_type not in settings.ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported image type: {content_type}. "
            f"Allowed: {settings.ALLOWED_CONTENT_TYPES}",
        )

    # Try to open and verify the image
    try:
        image = Image.open(io.BytesIO(image_bytes))
        image.verify()
        # Re-open after verify (verify() can make the image unusable)
        image = Image.open(io.BytesIO(image_bytes))
        return image
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"Corrupt or invalid image file: {str(e)}",
        )


# ─── Helper: ownership/access check for single complaint ────

def _enforce_complaint_access(complaint: dict, current_user: UserPayload) -> None:
    """
    Enforce access control for a single complaint.

    - Admin: always allowed
    - Officer: allowed only if complaint is assigned to their department
    - Citizen: allowed only if they own the complaint (citizen_id match)

    Returns 404 (not 403) to prevent ID enumeration.
    """
    if current_user.role == "administrator":
        return  # Full access

    if current_user.role == "department_officer":
        complaint_dept = str(complaint.get("department_id") or "")
        complaint_citizen = str(complaint.get("citizen_id") or "")
        if complaint_dept == current_user.department_id or complaint_citizen == current_user.id:
            return
        raise HTTPException(status_code=404, detail="Complaint not found")

    if current_user.role == "citizen":
        complaint_citizen = str(complaint.get("citizen_id") or "")
        if complaint_citizen != current_user.id:
            raise HTTPException(status_code=404, detail="Complaint not found")
        return

    raise HTTPException(status_code=403, detail="Insufficient permissions")


# ═══════════════════════════════════════════════════════════════
# COMPLAINT ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.post(
    "/complaints",
    response_model=ComplaintResponse,
    status_code=201,
    summary="Submit a new civic infrastructure complaint",
    description="Upload an image with optional GPS/timestamp metadata. "
    "Returns a complaint ID immediately. Detection runs asynchronously. "
    "Requires authenticated user account (citizen, administrator, or department officer).",
)
async def create_complaint(
    current_user: UserPayload = Depends(require_any_role("citizen", "administrator", "department_officer")),
    image: UploadFile = File(..., description="Image file (JPEG, PNG, WEBP, TIFF)"),
    lat: Optional[float] = Form(None, description="GPS latitude (-90 to 90)"),
    lng: Optional[float] = Form(None, description="GPS longitude (-180 to 180)"),
    timestamp: Optional[str] = Form(None, description="Capture timestamp (ISO 8601)"),
    source: str = Form("mobile_app", description="Source: mobile_app, cctv, drone"),
    location_source: str = Form("device", description="How location was determined: image_exif, device, manual"),
    description: Optional[str] = Form(None, description="Problem description entered by citizen"),
    location_accuracy: Optional[float] = Form(None, description="Location accuracy in meters"),
    location_address: Optional[str] = Form(None, description="OSM reverse-geocoded address string"),
    user_selected_category: Optional[str] = Form(None, description="Category chosen by user (e.g. pothole, streetlight)"),
):
    """
    Create a new complaint from an uploaded image.
    Ownership is set from the authenticated citizen's identity.
    """
    # --- Step 1: Read and validate image ---
    image_bytes = await image.read()

    if not image_bytes:
        raise HTTPException(status_code=422, detail="Empty image file")

    content_type = image.content_type or "image/jpeg"
    pil_image = _validate_image(image_bytes, content_type)

    # --- Step 2: Resolve GPS coordinates ---
    final_lat = lat
    final_lng = lng
    final_location_source = location_source

    if final_lat is None or final_lng is None:
        exif_data = _extract_exif_gps(pil_image)
        if exif_data.get("lat") is not None and exif_data.get("lng") is not None:
            if final_lat is None:
                final_lat = exif_data.get("lat")
            if final_lng is None:
                final_lng = exif_data.get("lng")
            final_location_source = "image_exif"

    if final_lat is None or final_lng is None:
        raise HTTPException(
            status_code=422,
            detail="GPS coordinates required. Provide lat/lng in form data "
            "or ensure the image contains EXIF GPS data.",
        )

    if not (-90 <= final_lat <= 90):
        raise HTTPException(status_code=422, detail="Latitude must be between -90 and 90")
    if not (-180 <= final_lng <= 180):
        raise HTTPException(status_code=422, detail="Longitude must be between -180 and 180")

    try:
        metadata = ComplaintMetadata(
            lat=final_lat,
            lng=final_lng,
            source=source,
            description=description,
            location_accuracy=location_accuracy,
            location_address=location_address,
            user_selected_category=user_selected_category,
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    # --- Step 3: Blur faces and license plates ---
    blurred_bytes = blur_service.blur_image(image_bytes)

    # --- Step 4: Upload both images to S3 ---
    import uuid

    temp_id = str(uuid.uuid4())

    original_url = storage_service.upload_original(
        image_bytes, temp_id, content_type
    )
    blurred_url = storage_service.upload_blurred(
        blurred_bytes, temp_id, content_type
    )

    # --- Step 5: Insert complaint with citizen ownership ---
    from datetime import datetime as dt

    ts = None
    if timestamp:
        try:
            ts = dt.fromisoformat(timestamp)
        except ValueError:
            pass

    complaint = db_service.insert_complaint(
        image_url=original_url,
        blurred_image_url=blurred_url,
        lat=final_lat,
        lng=final_lng,
        source=metadata.source,
        timestamp=ts,
        location_source=final_location_source,
        description=metadata.description,
        location_accuracy=metadata.location_accuracy,
        location_address=metadata.location_address,
        user_selected_category=metadata.user_selected_category,
        citizen_id=current_user.id,  # Ownership from authenticated identity
    )

    # --- Step 6: Publish detection job ---
    downstream_image_url = blurred_url if (settings.BLUR_ENABLED and blurred_url) else original_url
    queue_publisher.publish_detection_job(
        complaint_id=str(complaint["id"]),
        image_url=downstream_image_url,
    )

    # --- Step 7: Return response ---
    logger.info(f"Complaint created: {complaint['id']} by citizen {current_user.email}")

    return ComplaintResponse(
        id=complaint["id"],
        status=complaint["status"],
        image_url=complaint["image_url"],
        created_at=complaint["created_at"],
        message="Complaint submitted successfully. Detection in progress.",
    )


@router.get(
    "/complaints",
    response_model=list[DetailedComplaintResponse],
    summary="List complaints (admin/officer scoped)",
    description="Retrieve complaints with optional filtering. "
    "Admin sees all; officer sees own department only.",
)
async def list_complaints(
    current_user: UserPayload = Depends(require_role("administrator", "department_officer")),
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
):
    # Officers can only see their own department
    effective_dept = department_id
    if current_user.role == "department_officer":
        effective_dept = current_user.department_id

    try:
        return db_service.list_complaints(
            status=status,
            department_id=effective_dept,
            min_severity=min_severity,
            issue_class=issue_class,
            user_selected_category=user_selected_category,
            min_priority=min_priority,
            sla_state=sla_state,
            search=search,
            limit=limit,
            offset=offset,
        )
    except ValueError as ve:
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to query complaints list: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Database query failed. Please try again later."
        )


@router.get(
    "/complaints/stats",
    response_model=ComplaintStatsResponse,
    summary="Get operational complaint KPIs",
    description="Retrieve live aggregate KPI counts. Requires admin or officer role.",
)
async def get_complaint_stats(
    current_user: UserPayload = Depends(require_role("administrator", "department_officer")),
):
    """Retrieve live operational statistics across complaints."""
    try:
        return db_service.get_complaint_stats()
    except Exception as e:
        logger.error(f"Failed to fetch complaint stats: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve operational complaint stats."
        )


@router.get(
    "/complaints/{complaint_id}",
    response_model=DetailedComplaintResponse,
    summary="Get a complaint by ID",
    description="Retrieve complete status and details. Access enforced by ownership/role.",
)
async def get_complaint(
    complaint_id: UUID,
    current_user: UserPayload = Depends(get_current_user),
):
    """Retrieve single complaint with ownership enforcement."""
    try:
        complaint = db_service.get_complaint_by_id(str(complaint_id))
    except Exception as e:
        logger.error(f"Failed to fetch complaint {complaint_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Database query failed: unable to fetch complaint details."
        )

    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")

    _enforce_complaint_access(complaint, current_user)
    return complaint


@router.get(
    "/complaints/{complaint_id}/history",
    response_model=list[StatusHistoryItem],
    summary="Get complaint status lifecycle history",
    description="Retrieve the chronological audit trail. Access enforced by ownership/role.",
)
async def get_complaint_history(
    complaint_id: UUID,
    current_user: UserPayload = Depends(get_current_user),
):
    """Retrieve status history with ownership enforcement."""
    try:
        complaint = db_service.get_complaint_by_id(str(complaint_id))
        if not complaint:
            raise HTTPException(status_code=404, detail="Complaint not found")
        _enforce_complaint_access(complaint, current_user)
        return db_service.get_status_history(str(complaint_id))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch status history for {complaint_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve complaint status history."
        )


@router.patch(
    "/complaints/{complaint_id}/status",
    response_model=DetailedComplaintResponse,
    summary="Update complaint status",
    description="Update operational status. Admin/officer only. Actor is derived from authenticated user.",
)
async def update_complaint_status(
    complaint_id: UUID,
    req: UpdateStatusRequest,
    current_user: UserPayload = Depends(require_role("administrator", "department_officer")),
):
    """
    Update complaint lifecycle status.
    Actor is ALWAYS derived from the authenticated user — client-supplied actor is ignored.
    """
    # For officers: verify complaint belongs to their department
    if current_user.role == "department_officer":
        complaint = db_service.get_complaint_by_id(str(complaint_id))
        if not complaint:
            raise HTTPException(status_code=404, detail="Complaint not found")
        complaint_dept = str(complaint.get("department_id") or "")
        if complaint_dept != current_user.department_id:
            raise HTTPException(status_code=404, detail="Complaint not found")

    # Actor derived from authenticated identity — NEVER from client
    authenticated_actor = current_user.email

    try:
        updated = db_service.update_complaint_status(
            str(complaint_id),
            req.status,
            actor=authenticated_actor,
            notes=req.notes,
            actor_user_id=current_user.id,
        )
    except ValueError as ve:
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to update status for {complaint_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database update failed. Please try again later.")

    if not updated:
        raise HTTPException(status_code=404, detail="Complaint not found")

    return updated


@router.patch(
    "/complaints/{complaint_id}/assign",
    response_model=DetailedComplaintResponse,
    summary="Assign department to complaint (admin only)",
    description="Assign or reassign a complaint to a municipal department. Admin only.",
)
@router.post(
    "/complaints/{complaint_id}/assign",
    response_model=DetailedComplaintResponse,
    include_in_schema=False,
)
async def assign_department(
    complaint_id: UUID,
    req: AssignDepartmentRequest,
    current_user: UserPayload = Depends(require_role("administrator")),
):
    """Assign or reassign department for a complaint. Admin only."""
    try:
        updated = db_service.assign_department(str(complaint_id), str(req.department_id))
    except ValueError as ve:
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to assign department for {complaint_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database update failed. Please try again later.")

    if not updated:
        raise HTTPException(status_code=404, detail="Complaint not found")

    return updated


# ═══════════════════════════════════════════════════════════════
# DEPARTMENT ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.get(
    "/departments",
    response_model=list[DepartmentResponse],
    summary="List all departments",
    description="Retrieve all municipal departments. Admin/officer access.",
)
async def list_departments(
    current_user: UserPayload = Depends(require_role("administrator", "department_officer")),
):
    """List all municipal departments."""
    try:
        return db_service.list_departments()
    except Exception as e:
        logger.error(f"Failed to list departments: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve municipal departments.")


@router.get(
    "/departments/operations",
    response_model=list[DepartmentOperationsSummary],
    summary="Get department operations overview (admin only)",
    description="Retrieve operational task counts across all departments. Admin only.",
)
async def get_department_operations(
    current_user: UserPayload = Depends(require_role("administrator")),
):
    """Get operational workload metrics for all municipal departments. Admin only."""
    try:
        return db_service.get_department_operations_summary()
    except Exception as e:
        logger.error(f"Failed to fetch department operations: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve department operations summary.")


@router.get(
    "/departments/{department_id}/tasks",
    response_model=list[DetailedComplaintResponse],
    summary="Get department work queue tasks",
    description="Department-scoped work queue. Officers see only their department.",
)
async def get_department_tasks(
    department_id: UUID,
    current_user: UserPayload = Depends(require_role("administrator", "department_officer")),
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    """Get active task queue for a department with access enforcement."""
    # Enforce department scope
    validate_department_access(current_user, str(department_id))

    if limit < 1 or limit > 100:
        raise HTTPException(status_code=422, detail="Limit must be between 1 and 100")
    if offset < 0:
        raise HTTPException(status_code=422, detail="Offset cannot be negative")

    if status and status.lower() not in ("all", "overdue", "pending", "under_review", "assigned", "in_progress", "repaired", "verified", "closed", "rejected"):
        raise HTTPException(status_code=422, detail=f"Invalid status filter '{status}'")

    dept = db_service.get_department_by_id(str(department_id))
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    try:
        return db_service.get_department_tasks(
            str(department_id),
            status_filter=status,
            limit=limit,
            offset=offset,
        )
    except Exception as e:
        logger.error(f"Failed to fetch tasks for department {department_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve department tasks.")


@router.get(
    "/departments/{department_id}/notifications",
    response_model=list[DepartmentNotificationResponse],
    summary="Get department notifications",
    description="Department-scoped notifications. Officers see only their department.",
)
async def get_department_notifications(
    department_id: UUID,
    current_user: UserPayload = Depends(require_role("administrator", "department_officer")),
    limit: int = 20,
):
    """Get notifications for a department with access enforcement."""
    # Enforce department scope
    validate_department_access(current_user, str(department_id))

    if limit < 1 or limit > 100:
        raise HTTPException(status_code=422, detail="Limit must be between 1 and 100")

    dept = db_service.get_department_by_id(str(department_id))
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    try:
        return db_service.get_department_notifications(str(department_id), limit=limit)
    except Exception as e:
        logger.error(f"Failed to fetch notifications for department {department_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve department notifications.")


@router.patch(
    "/notifications/{notification_id}/read",
    summary="Mark notification as read",
    description="Acknowledge a notification. Officer must own the department.",
)
async def mark_notification_read(
    notification_id: UUID,
    current_user: UserPayload = Depends(require_role("administrator", "department_officer")),
    department_id: Optional[UUID] = None,
):
    """
    Mark a department notification as read.
    For officers: department scope is enforced using their authenticated department_id.
    """
    # For officers: always use their authenticated department_id (ignore client param)
    effective_dept_id = None
    if current_user.role == "department_officer":
        effective_dept_id = current_user.department_id
    elif department_id:
        effective_dept_id = str(department_id)

    try:
        success = db_service.mark_notification_read(
            str(notification_id),
            department_id=effective_dept_id,
        )
        if not success:
            raise HTTPException(status_code=404, detail="Notification not found or does not belong to your department")
        return {"success": True, "id": str(notification_id)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to mark notification read for {notification_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to mark notification as read.")

"""
Pydantic models for request/response schemas.

These models define the API contract for the ingestion service.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class ComplaintMetadata(BaseModel):
    """Optional metadata sent alongside the image upload."""

    lat: Optional[float] = Field(None, ge=-90, le=90, description="GPS latitude")
    lng: Optional[float] = Field(None, ge=-180, le=180, description="GPS longitude")
    timestamp: Optional[datetime] = Field(
        None, description="Capture timestamp (ISO 8601)"
    )
    source: str = Field(
        default="mobile_app",
        description="Submission source: mobile_app, cctv, or drone",
    )
    description: Optional[str] = Field(None, max_length=1000, description="Citizen description")
    location_accuracy: Optional[float] = Field(None, ge=0, description="Sensor accuracy in meters")
    location_address: Optional[str] = Field(None, max_length=500, description="Reverse-geocoded descriptive address")
    user_selected_category: Optional[str] = Field(None, max_length=50, description="User-reported category")

    @field_validator("source")
    @classmethod
    def validate_source(cls, v: str) -> str:
        allowed = {"mobile_app", "cctv", "drone"}
        if v not in allowed:
            raise ValueError(f"source must be one of {allowed}, got '{v}'")
        return v


class ComplaintResponse(BaseModel):
    """Response returned after successful complaint submission."""

    id: UUID
    status: str = "pending"
    image_url: str
    created_at: datetime
    message: str = "Complaint submitted successfully. Detection in progress."


class ErrorResponse(BaseModel):
    """Standard error response."""

    detail: str
    code: str = "VALIDATION_ERROR"


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = "healthy"
    service: str = "ingestion-api"
    version: str = "1.0.0"


class StatusHistoryItem(BaseModel):
    """Immutable audit entry for a status transition."""

    id: UUID
    complaint_id: UUID
    previous_status: Optional[str] = None
    new_status: str
    changed_at: datetime
    actor: str = "system"
    notes: Optional[str] = None


class DetailedComplaintResponse(BaseModel):
    """Detailed representation of a complaint for read queries."""

    id: UUID
    image_url: str
    blurred_image_url: Optional[str] = None
    lat: float
    lng: float
    issue_class: str
    confidence: float
    severity_score: Optional[float] = None
    priority_score: Optional[float] = None
    status: str
    department_id: Optional[UUID] = None
    department_name: Optional[str] = None
    sla_deadline: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    source: Optional[str] = "mobile_app"
    location_source: Optional[str] = None
    description: Optional[str] = None
    location_accuracy: Optional[float] = None
    location_address: Optional[str] = None
    user_selected_category: Optional[str] = None
    duplicate_of_id: Optional[UUID] = None
    status_history: Optional[list[StatusHistoryItem]] = None


class UpdateStatusRequest(BaseModel):
    """Request payload to update complaint status."""

    status: str = Field(
        ...,
        description="Allowed statuses: pending, under_review, assigned, in_progress, repaired, verified, closed, rejected",
    )
    notes: Optional[str] = Field(None, max_length=500, description="Optional operational notes for status update")
    actor: Optional[str] = Field("admin_operator", max_length=50, description="Operator or subsystem identifier")


class AssignDepartmentRequest(BaseModel):
    """Request payload to assign or reassign a department to a complaint."""
    department_id: UUID = Field(..., description="Target department UUID")


class DepartmentResponse(BaseModel):
    """Department summary response."""
    id: UUID
    name: str
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None


class ComplaintStatsResponse(BaseModel):
    """Live database KPIs and statistics summary."""
    total: int
    pending: int
    under_review: int
    assigned: int
    in_progress: int
    repaired: int
    verified: int
    closed: int
    rejected: int
    high_priority: int
    overdue_sla: int


class DepartmentNotificationResponse(BaseModel):
    """Department notification event record."""
    id: UUID
    department_id: UUID
    complaint_id: UUID
    type: str
    title: str
    message: str
    priority: str = "normal"
    read: bool = False
    created_at: datetime


class DepartmentOperationsSummary(BaseModel):
    """Operational workload metrics for a municipal department."""
    id: UUID
    name: str
    active_tasks: int
    new_assignments: int
    overdue_tasks: int
    recent_notifications: list[DepartmentNotificationResponse] = []


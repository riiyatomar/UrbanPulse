-- ============================================================
-- Migration 013: Department Notifications Table
-- UrbanPulse Civic Issue Tracking System
-- ============================================================

CREATE TABLE IF NOT EXISTS department_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dept_notif_dept 
    ON department_notifications(department_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dept_notif_complaint 
    ON department_notifications(complaint_id);

-- ============================================================
-- Migration 012: Add complaint_status_history table
-- UrbanPulse Civic Issue Tracking System (Phase 4 Hardening)
-- ============================================================
-- Records an immutable audit log of all complaint status transitions.
-- Tracks:
--   complaint_id     — Foreign key to complaints(id)
--   previous_status  — Previous status (null on initial creation)
--   new_status       — New status after transition
--   changed_at       — Timestamp of the transition
--   actor            — Actor or subsystem initiating change
--   notes            — Optional rationale or operational notes
-- ============================================================

CREATE TABLE IF NOT EXISTS complaint_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    previous_status complaint_status,
    new_status complaint_status NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor VARCHAR(50) NOT NULL DEFAULT 'system',
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_status_history_complaint_id 
    ON complaint_status_history(complaint_id, changed_at ASC);

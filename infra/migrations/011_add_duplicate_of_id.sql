-- ============================================================
-- Migration 011: Add duplicate_of_id to complaints
-- UrbanPulse Civic Issue Tracking System (Phase 4)
-- ============================================================
-- Tracks parent complaint UUID when a complaint is resolved as a duplicate.
-- Foreign key references complaints(id) ON DELETE SET NULL.
-- ============================================================

ALTER TABLE complaints
    ADD COLUMN IF NOT EXISTS duplicate_of_id UUID REFERENCES complaints(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_complaints_duplicate_of_id ON complaints(duplicate_of_id) WHERE duplicate_of_id IS NOT NULL;

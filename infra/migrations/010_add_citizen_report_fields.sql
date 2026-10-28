-- ============================================================
-- Migration 010: Add citizen report fields to complaints
-- UrbanPulse Civic Issue Tracking System (Phase 2.5)
-- ============================================================
-- Adds optional metadata provided by citizen reporting:
--   description            — user-written problem context
--   location_accuracy      — GPS sensor accuracy radius in meters
--   location_address       — OpenStreetMap Nominatim reverse-geocoded descriptive address
--   user_selected_category — category selected by user (distinct from ML issue_class)
-- ============================================================

ALTER TABLE complaints
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS location_accuracy REAL,
    ADD COLUMN IF NOT EXISTS location_address TEXT,
    ADD COLUMN IF NOT EXISTS user_selected_category VARCHAR(50);

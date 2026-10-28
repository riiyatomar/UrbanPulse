-- ============================================================
-- Migration 014: Users, Authentication & RBAC
-- UrbanPulse Civic Issue Tracking System
-- ============================================================
-- Adds:
--   1. user_role enum (citizen, department_officer, administrator)
--   2. users table with password hash, role, department FK
--   3. citizen_id ownership column on complaints
--   4. actor_user_id + expanded actor on complaint_status_history
--   5. Indexes for email lookup and complaint ownership
-- ============================================================

-- 1. Role enum
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('citizen', 'department_officer', 'administrator');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 2. Users table
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    email           VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            user_role NOT NULL DEFAULT 'citizen',
    department_id   UUID REFERENCES departments(id) ON UPDATE CASCADE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Department officers MUST have a department
    CONSTRAINT chk_officer_dept CHECK (
        role <> 'department_officer' OR department_id IS NOT NULL
    )
);

-- Case-insensitive unique email
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
    ON users (LOWER(email));

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    CREATE TRIGGER trg_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW
        EXECUTE FUNCTION update_users_updated_at();
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 3. Citizen ownership on complaints (nullable for pre-existing complaints)
ALTER TABLE complaints
    ADD COLUMN IF NOT EXISTS citizen_id UUID REFERENCES users(id) ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS idx_complaints_citizen_id
    ON complaints(citizen_id);

-- 4. Expand actor field and add actor_user_id FK on status history
-- Expand from VARCHAR(50) to VARCHAR(255) to support email addresses
ALTER TABLE complaint_status_history
    ALTER COLUMN actor TYPE VARCHAR(255);

-- Add immutable FK reference to users for audit integrity
ALTER TABLE complaint_status_history
    ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES users(id) ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS idx_status_history_actor_user
    ON complaint_status_history(actor_user_id);

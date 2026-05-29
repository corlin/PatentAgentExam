-- Migration: Add password_hash to users table
-- Description: Adds a new column for credential-based authentication.

ALTER TABLE users ADD COLUMN password_hash TEXT;

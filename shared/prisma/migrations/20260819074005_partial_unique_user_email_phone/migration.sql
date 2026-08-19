-- DropIndex
DROP INDEX "users_email_key";

-- DropIndex
DROP INDEX "users_phone_key";

-- Allow email/phone reuse once a user is soft-deleted: enforce uniqueness
-- only among rows that are still active (deleted_at IS NULL).
CREATE UNIQUE INDEX users_email_active_idx ON users (email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_phone_active_idx ON users (phone) WHERE deleted_at IS NULL;

-- Phase 1 Critical Fixes Migration
-- Audit findings: #1 (unique email/phone), #2 (stripeAccountId), #18-19 (CHECK constraints)

-- 1. Add stripe_account_id column to expert_profiles (Audit #2 — Critical)
ALTER TABLE "expert_profiles" ADD COLUMN "stripe_account_id" VARCHAR(128);

-- 2. Partial unique indexes on email/phone for non-deleted users (Audit #1 — Critical)
-- Prevents multiple active users from sharing the same email or phone.
-- Allows deleted users to retain their old email/phone without conflicting.
CREATE UNIQUE INDEX "idx_users_email_active"
  ON "users" ("email")
  WHERE "email" IS NOT NULL AND "status" NOT IN ('deleted');

CREATE UNIQUE INDEX "idx_users_phone_active"
  ON "users" ("phone")
  WHERE "phone" IS NOT NULL AND "status" NOT IN ('deleted');

-- 3. Performance indexes for login queries (Audit #33)
CREATE INDEX "idx_users_email" ON "users" ("email") WHERE "email" IS NOT NULL;
CREATE INDEX "idx_users_phone" ON "users" ("phone") WHERE "phone" IS NOT NULL;

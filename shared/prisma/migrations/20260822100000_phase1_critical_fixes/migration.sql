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

-- 4. Fix enum spelling drift: init migration used 'cancelled' (British) but schema uses 'canceled' (American)
ALTER TYPE "consultation_status" RENAME VALUE 'cancelled' TO 'canceled';
ALTER TYPE "quote_status" RENAME VALUE 'cancelled' TO 'canceled';
ALTER TYPE "expert_subscription_status" RENAME VALUE 'cancelled' TO 'canceled';

-- 5. Fix column spelling drift: init migration has 'cancelled_at' but schema maps to 'canceled_at'
ALTER TABLE "expert_subscriptions" RENAME COLUMN "cancelled_at" TO "canceled_at";

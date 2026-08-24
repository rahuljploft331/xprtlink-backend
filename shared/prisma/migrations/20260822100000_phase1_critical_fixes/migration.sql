-- Phase 1 Critical Fixes Migration
-- Audit findings: #1 (unique email/phone), #2 (stripeAccountId), #18-19 (CHECK constraints)

-- 1. Add stripe_account_id column to expert_profiles (Audit #2 — Critical)
--    Guard: only add if the column doesn't already exist (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expert_profiles' AND column_name = 'stripe_account_id'
  ) THEN
    ALTER TABLE "expert_profiles" ADD COLUMN "stripe_account_id" VARCHAR(128);
  END IF;
END $$;

-- 2. Partial unique indexes on email/phone for non-deleted users (Audit #1 — Critical)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_email_active"
  ON "users" ("email")
  WHERE "email" IS NOT NULL AND "status" NOT IN ('deleted');

CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_phone_active"
  ON "users" ("phone")
  WHERE "phone" IS NOT NULL AND "status" NOT IN ('deleted');

-- 3. Performance indexes for login queries (Audit #33)
CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users" ("email") WHERE "email" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_users_phone" ON "users" ("phone") WHERE "phone" IS NOT NULL;

-- 4. Fix enum spelling drift: init migration used 'cancelled' (British) but schema uses 'canceled' (American)
--    Guard: only rename if the old label still exists (idempotent — server may have had this applied manually)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'consultation_status' AND e.enumlabel = 'cancelled'
  ) THEN
    ALTER TYPE "consultation_status" RENAME VALUE 'cancelled' TO 'canceled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'quote_status' AND e.enumlabel = 'cancelled'
  ) THEN
    ALTER TYPE "quote_status" RENAME VALUE 'cancelled' TO 'canceled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'expert_subscription_status' AND e.enumlabel = 'cancelled'
  ) THEN
    ALTER TYPE "expert_subscription_status" RENAME VALUE 'cancelled' TO 'canceled';
  END IF;
END $$;

-- 5. Fix column spelling drift: init migration has 'cancelled_at' but schema maps to 'canceled_at'
--    Guard: only rename if the old column still exists (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expert_subscriptions' AND column_name = 'cancelled_at'
  ) THEN
    ALTER TABLE "expert_subscriptions" RENAME COLUMN "cancelled_at" TO "canceled_at";
  END IF;
END $$;

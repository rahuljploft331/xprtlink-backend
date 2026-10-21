-- AlterEnum
ALTER TYPE "expert_subscription_status" ADD VALUE IF NOT EXISTS 'on_hold';

-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "apple_product_id" VARCHAR(128);
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "google_product_id" VARCHAR(128);

-- AlterTable
ALTER TABLE "expert_subscriptions" ADD COLUMN IF NOT EXISTS "grace_period_end" TIMESTAMPTZ(6);

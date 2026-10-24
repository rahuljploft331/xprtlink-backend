-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN "web_price_monthly_cents" INTEGER,
ADD COLUMN "web_trial_days" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "expert_subscriptions" ADD COLUMN "trial_ends_at" TIMESTAMPTZ(6);

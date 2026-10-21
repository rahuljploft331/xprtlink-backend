ALTER TABLE "expert_subscriptions" ADD COLUMN IF NOT EXISTS "last_verified_at" TIMESTAMPTZ(6);

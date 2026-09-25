-- Cached Stripe Connect payout readiness for experts (Stripe-hosted onboarding).
-- Additive: new NOT NULL column has a default, second column is nullable.
ALTER TABLE "expert_profiles" ADD COLUMN "stripe_transfers_active" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "expert_profiles" ADD COLUMN "stripe_status_checked_at" TIMESTAMPTZ(6);

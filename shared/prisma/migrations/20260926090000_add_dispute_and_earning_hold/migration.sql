-- Chargeback / Stripe-Dashboard refund handling. Additive only.
ALTER TABLE "consultation_charges" ADD COLUMN "dispute_status" VARCHAR(16);
ALTER TABLE "consultation_charges" ADD COLUMN "stripe_dispute_id" VARCHAR(128);
ALTER TABLE "consultation_charges" ADD COLUMN "disputed_at" TIMESTAMPTZ(6);
ALTER TABLE "consultation_charges" ADD COLUMN "needs_review" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "consultation_charges" ADD COLUMN "review_note" VARCHAR(500);
ALTER TABLE "expert_earnings_ledger" ADD COLUMN "hold_reason" VARCHAR(32);

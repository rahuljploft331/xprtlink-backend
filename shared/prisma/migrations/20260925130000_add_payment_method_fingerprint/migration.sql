-- Add fingerprint column for card-level dedup (same physical card yields the same
-- Stripe fingerprint even across different PaymentMethod tokens).
ALTER TABLE "payment_methods" ADD COLUMN "fingerprint" VARCHAR(128);

-- Prevent the same physical card being stored twice for one customer.
-- NULL fingerprints remain distinct in Postgres, so legacy rows are unaffected.
CREATE UNIQUE INDEX "payment_methods_customer_profile_id_fingerprint_key"
  ON "payment_methods" ("customer_profile_id", "fingerprint");

-- Phase 3: Database-enforced correctness via CHECK constraints
-- Audit findings: #18 (rating), #19 (monetary), #31 (duration), #33 (experienceYears),
-- #34 (active consultation uniqueness), #39 (media size)
--
-- Principle: prefer database-enforced correctness over relying entirely on application code.

-- ─── Review rating bounds (1–5) ─────────────────────────────────────────────
ALTER TABLE "reviews"
  ADD CONSTRAINT "chk_reviews_rating" CHECK ("rating" >= 1 AND "rating" <= 5);

-- ─── Non-negative monetary amounts ──────────────────────────────────────────

-- transactions
ALTER TABLE "transactions"
  ADD CONSTRAINT "chk_transactions_amount_positive" CHECK ("amount_cents" >= 0);

-- consultation_charges
ALTER TABLE "consultation_charges"
  ADD CONSTRAINT "chk_charges_commission_positive" CHECK ("commission_cents" >= 0),
  ADD CONSTRAINT "chk_charges_expert_share_positive" CHECK ("expert_share_cents" >= 0);

-- expert_earnings_ledger
ALTER TABLE "expert_earnings_ledger"
  ADD CONSTRAINT "chk_earnings_gross_positive" CHECK ("gross_cents" >= 0),
  ADD CONSTRAINT "chk_earnings_commission_positive" CHECK ("commission_cents" >= 0),
  ADD CONSTRAINT "chk_earnings_net_positive" CHECK ("net_cents" >= 0);

-- expert_profiles.consultation_rate_cents
ALTER TABLE "expert_profiles"
  ADD CONSTRAINT "chk_expert_rate_positive" CHECK ("consultation_rate_cents" >= 0),
  ADD CONSTRAINT "chk_expert_experience_positive" CHECK ("experience_years" >= 0),
  ADD CONSTRAINT "chk_expert_rating_avg_range" CHECK ("rating_avg" >= 0 AND "rating_avg" <= 5),
  ADD CONSTRAINT "chk_expert_rating_count_positive" CHECK ("rating_count" >= 0);

-- consultations.rate_per_minute_cents and duration_seconds
ALTER TABLE "consultations"
  ADD CONSTRAINT "chk_consultation_rate_positive" CHECK ("rate_per_minute_cents" >= 0),
  ADD CONSTRAINT "chk_consultation_duration_positive" CHECK ("duration_seconds" >= 0 OR "duration_seconds" IS NULL);

-- expert_payouts.amount_cents
ALTER TABLE "expert_payouts"
  ADD CONSTRAINT "chk_payout_amount_positive" CHECK ("amount_cents" >= 0);

-- subscription_plans.price_monthly_cents
ALTER TABLE "subscription_plans"
  ADD CONSTRAINT "chk_plan_price_positive" CHECK ("price_monthly_cents" >= 0);

-- quote_requests.budget_cents and expert_quote_amount_cents
ALTER TABLE "quote_requests"
  ADD CONSTRAINT "chk_quote_budget_positive" CHECK ("budget_cents" >= 0 OR "budget_cents" IS NULL),
  ADD CONSTRAINT "chk_quote_amount_positive" CHECK ("expert_quote_amount_cents" >= 0 OR "expert_quote_amount_cents" IS NULL);

-- ─── Payment method expiry bounds ───────────────────────────────────────────
ALTER TABLE "payment_methods"
  ADD CONSTRAINT "chk_pm_exp_month_range" CHECK ("exp_month" >= 1 AND "exp_month" <= 12),
  ADD CONSTRAINT "chk_pm_exp_year_range" CHECK ("exp_year" >= 2020 AND "exp_year" <= 2100);

-- ─── Media asset size must be positive ──────────────────────────────────────
ALTER TABLE "media_assets"
  ADD CONSTRAINT "chk_media_size_positive" CHECK ("size_bytes" > 0);

-- ─── Prevent duplicate active consultations (same customer + expert pair) ───
-- Only one consultation in an active state per customer-expert pair at a time.
CREATE UNIQUE INDEX "idx_consultation_active_pair"
  ON "consultations" ("customer_id", "expert_id")
  WHERE "status" IN ('requested', 'ringing', 'accepted', 'in_progress');

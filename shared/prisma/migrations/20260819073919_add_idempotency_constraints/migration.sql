-- CreateIndex
CREATE UNIQUE INDEX "consultations_stripe_payment_intent_id_key" ON "consultations"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "expert_earnings_ledger_consultation_id_key" ON "expert_earnings_ledger"("consultation_id");

-- CreateIndex
CREATE UNIQUE INDEX "expert_payouts_expert_profile_id_period_start_period_end_key" ON "expert_payouts"("expert_profile_id", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "expert_subscriptions_store_external_subscription_id_key" ON "expert_subscriptions"("store", "external_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_stripe_payment_intent_id_key" ON "transactions"("stripe_payment_intent_id");

-- One active subscription per expert (partial unique index; not expressible via Prisma's @@unique)
CREATE UNIQUE INDEX expert_subscriptions_one_active_idx ON expert_subscriptions (expert_profile_id) WHERE status = 'active';

-- Allow one consultation's earning to be split into a paid part and an unpaid
-- remainder (admin custom-amount payouts). Settlement idempotency is still
-- guaranteed by the unique index on consultation_charges.consultation_id.
DROP INDEX "expert_earnings_ledger_consultation_id_key";
CREATE INDEX "expert_earnings_ledger_consultation_id_idx" ON "expert_earnings_ledger"("consultation_id");

-- AlterTable
ALTER TABLE "expert_earnings_ledger" ADD COLUMN     "payout_id" UUID;

-- CreateIndex
CREATE INDEX "expert_earnings_ledger_expert_profile_id_payout_id_idx" ON "expert_earnings_ledger"("expert_profile_id", "payout_id");

-- AddForeignKey
ALTER TABLE "expert_earnings_ledger" ADD CONSTRAINT "expert_earnings_ledger_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "expert_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

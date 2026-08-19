-- Protect financial records: a Consultation row must not be deletable while its
-- charge breakdown (ConsultationCharge) or earnings ledger entry still exists.
-- Previously both FKs were CASCADE, which would silently wipe accounting data
-- when a consultation row was deleted.

-- ConsultationCharge.consultationId: CASCADE → RESTRICT
ALTER TABLE "consultation_charges"
  DROP CONSTRAINT "consultation_charges_consultation_id_fkey";

ALTER TABLE "consultation_charges"
  ADD CONSTRAINT "consultation_charges_consultation_id_fkey"
  FOREIGN KEY ("consultation_id")
  REFERENCES "consultations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ExpertEarningsLedger.consultationId: CASCADE → RESTRICT
ALTER TABLE "expert_earnings_ledger"
  DROP CONSTRAINT "expert_earnings_ledger_consultation_id_fkey";

ALTER TABLE "expert_earnings_ledger"
  ADD CONSTRAINT "expert_earnings_ledger_consultation_id_fkey"
  FOREIGN KEY ("consultation_id")
  REFERENCES "consultations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

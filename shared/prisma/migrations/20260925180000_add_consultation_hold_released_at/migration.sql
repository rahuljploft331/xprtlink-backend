-- Marks consultations whose Stripe pre-auth hold has been cancelled, so the
-- hold-release sweep processes each row once. Additive, nullable.
ALTER TABLE "consultations" ADD COLUMN "hold_released_at" TIMESTAMPTZ(6);

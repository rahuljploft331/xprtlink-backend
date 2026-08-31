-- Add human-friendly reference number, category, and preferred location to quotes.

ALTER TABLE "quote_requests"
  ADD COLUMN "reference_number" VARCHAR(20),
  ADD COLUMN "category" VARCHAR(120),
  ADD COLUMN "preferred_location" VARCHAR(200);

-- Backfill existing rows with a generated QR-XXXXXXXX reference. Derived from a
-- per-row md5 (includes the unique id) so every backfilled value is distinct,
-- satisfying the unique index created below.
UPDATE "quote_requests"
SET "reference_number" = 'QR-' || upper(substr(md5(random()::text || id::text), 1, 8))
WHERE "reference_number" IS NULL;

-- Enforce uniqueness going forward.
CREATE UNIQUE INDEX "quote_requests_reference_number_key"
  ON "quote_requests"("reference_number");

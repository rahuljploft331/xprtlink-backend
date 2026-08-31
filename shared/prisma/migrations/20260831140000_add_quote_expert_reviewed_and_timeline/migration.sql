-- Add the `expert_reviewed` quote status (recorded when the assigned expert
-- first opens a pending request) and the expert's quotation timeline field.

-- New enum value. On PostgreSQL 12+ this is transaction-safe as long as the
-- value is not referenced within the same transaction (it isn't here).
ALTER TYPE "quote_status" ADD VALUE IF NOT EXISTS 'expert_reviewed' AFTER 'pending_expert_review';

-- Expert quotation estimated completion time (freeform, e.g. "5 Business Days")
-- and the timestamp the expert reviewed the request.
ALTER TABLE "quote_requests"
  ADD COLUMN "expert_quote_timeline" VARCHAR(120),
  ADD COLUMN "reviewed_at" TIMESTAMPTZ(6);

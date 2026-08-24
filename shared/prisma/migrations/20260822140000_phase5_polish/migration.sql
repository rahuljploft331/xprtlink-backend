-- Phase 5: Polish & Cleanup migration
-- Audit findings: #29 (ExpertVerification unique), #21/4.3 (role on RefreshToken)

-- 1. Ensure only one active verification record per expert.
-- If duplicates exist, keep the most recent and delete older ones before adding the constraint.
DELETE FROM "expert_verifications" a
  USING "expert_verifications" b
  WHERE a."expert_profile_id" = b."expert_profile_id"
    AND a."submitted_at" < b."submitted_at";

CREATE UNIQUE INDEX "idx_expert_verification_active"
  ON "expert_verifications" ("expert_profile_id")
  WHERE "status" IN ('pending', 'approved');

-- 2. Add role column to refresh_tokens for session role persistence.
-- When present, this is used during token refresh to maintain the same role
-- instead of silently defaulting to "customer" for dual-profile users.
ALTER TABLE "refresh_tokens" ADD COLUMN "role" VARCHAR(32);

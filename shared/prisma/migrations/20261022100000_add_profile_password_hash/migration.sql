-- Per-role passwords: each profile owns its own password hash.
ALTER TABLE "customer_profiles"
  ADD COLUMN "password_hash" VARCHAR(255),
  ADD COLUMN "password_updated_at" TIMESTAMPTZ(6);
ALTER TABLE "expert_profiles"
  ADD COLUMN "password_hash" VARCHAR(255),
  ADD COLUMN "password_updated_at" TIMESTAMPTZ(6);

-- Backfill: every existing profile inherits the account's current password,
-- so nobody is locked out and dual-role accounts keep working unchanged.
UPDATE "customer_profiles" cp
   SET "password_hash" = u."password_hash", "password_updated_at" = u."password_updated_at"
  FROM "users" u WHERE u."id" = cp."user_id" AND u."password_hash" IS NOT NULL;
UPDATE "expert_profiles" ep
   SET "password_hash" = u."password_hash", "password_updated_at" = u."password_updated_at"
  FROM "users" u WHERE u."id" = ep."user_id" AND u."password_hash" IS NOT NULL;

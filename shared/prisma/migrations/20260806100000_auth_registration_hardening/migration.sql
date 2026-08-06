-- AlterTable
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "otp_challenges" ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "otp_challenges" ADD COLUMN "blocked_until" TIMESTAMPTZ(6);

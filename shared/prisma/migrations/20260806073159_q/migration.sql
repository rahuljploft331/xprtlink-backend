-- AlterEnum
ALTER TYPE "user_status" ADD VALUE 'pending_verification';

-- AlterTable
ALTER TABLE "otp_challenges" ADD COLUMN     "registration_data" JSONB;

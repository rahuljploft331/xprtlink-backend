-- CreateEnum
CREATE TYPE "banner_approval_status" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "expert_banners" ADD COLUMN     "approval_status" "banner_approval_status" NOT NULL DEFAULT 'pending';

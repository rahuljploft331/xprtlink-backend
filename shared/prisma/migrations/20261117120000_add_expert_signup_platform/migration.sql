-- CreateEnum
CREATE TYPE "signup_platform" AS ENUM ('ios', 'android', 'web');

-- AlterTable
ALTER TABLE "expert_profiles" ADD COLUMN "signup_platform" "signup_platform";

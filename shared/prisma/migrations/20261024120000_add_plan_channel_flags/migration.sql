-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN "available_on_app" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "available_on_web" BOOLEAN NOT NULL DEFAULT true;

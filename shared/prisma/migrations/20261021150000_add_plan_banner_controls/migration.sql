CREATE TYPE "banner_frequency" AS ENUM ('monthly', 'weekly');

ALTER TABLE "subscription_plans"
  ADD COLUMN "banner_upload_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "banner_frequency" "banner_frequency" NOT NULL DEFAULT 'monthly';

UPDATE "subscription_plans" SET "banner_upload_enabled" = true WHERE "max_banners" > 0;

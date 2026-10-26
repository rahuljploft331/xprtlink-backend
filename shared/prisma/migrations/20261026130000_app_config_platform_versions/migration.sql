-- AlterTable
ALTER TABLE "app_config"
  ADD COLUMN "ios_min_version" VARCHAR(32),
  ADD COLUMN "ios_latest_version" VARCHAR(32),
  ADD COLUMN "ios_store_url" TEXT,
  ADD COLUMN "android_min_version" VARCHAR(32),
  ADD COLUMN "android_latest_version" VARCHAR(32),
  ADD COLUMN "android_store_url" TEXT;

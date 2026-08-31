-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN     "is_most_popular" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "key_features" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "tagline" VARCHAR(120);

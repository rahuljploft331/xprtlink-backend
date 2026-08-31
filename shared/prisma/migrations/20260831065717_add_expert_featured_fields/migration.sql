-- AlterTable
ALTER TABLE "expert_profiles" ADD COLUMN     "featured_rank" INTEGER,
ADD COLUMN     "featured_until" TIMESTAMPTZ(6),
ADD COLUMN     "is_featured" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "expert_profiles_is_featured_idx" ON "expert_profiles"("is_featured");

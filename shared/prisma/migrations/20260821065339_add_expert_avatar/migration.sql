-- AlterTable
ALTER TABLE "expert_profiles" ADD COLUMN     "avatar_media_id" UUID;

-- CreateIndex
CREATE INDEX "expert_profiles_avatar_media_id_idx" ON "expert_profiles"("avatar_media_id");

-- AddForeignKey
ALTER TABLE "expert_profiles" ADD CONSTRAINT "expert_profiles_avatar_media_id_fkey" FOREIGN KEY ("avatar_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

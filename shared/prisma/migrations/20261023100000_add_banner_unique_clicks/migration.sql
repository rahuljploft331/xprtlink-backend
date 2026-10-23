-- AlterTable
ALTER TABLE "expert_banner_daily_stats" ADD COLUMN "unique_clicks" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "expert_banner_clicks" (
    "banner_id" UUID NOT NULL,
    "viewer_key" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expert_banner_clicks_pkey" PRIMARY KEY ("banner_id","viewer_key")
);

-- AddForeignKey
ALTER TABLE "expert_banner_clicks" ADD CONSTRAINT "expert_banner_clicks_banner_id_fkey" FOREIGN KEY ("banner_id") REFERENCES "expert_banners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

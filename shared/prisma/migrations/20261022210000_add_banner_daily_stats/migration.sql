-- CreateTable
CREATE TABLE "expert_banner_daily_stats" (
    "banner_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "expert_banner_daily_stats_pkey" PRIMARY KEY ("banner_id","day")
);

-- CreateIndex
CREATE INDEX "expert_banner_daily_stats_day_idx" ON "expert_banner_daily_stats"("day");

-- AddForeignKey
ALTER TABLE "expert_banner_daily_stats" ADD CONSTRAINT "expert_banner_daily_stats_banner_id_fkey" FOREIGN KEY ("banner_id") REFERENCES "expert_banners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterEnum
ALTER TYPE "media_purpose" ADD VALUE IF NOT EXISTS 'banner';

-- AlterTable
ALTER TABLE "expert_profiles" ADD COLUMN IF NOT EXISTS "poor_reviews_alert" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "max_banners" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "attachment_id" UUID,
ADD COLUMN IF NOT EXISTS "reference_id" VARCHAR(100),
ALTER COLUMN "subject" DROP NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "faqs" (
    "id" UUID NOT NULL,
    "question" VARCHAR(500) NOT NULL,
    "answer" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "expert_banners" (
    "id" UUID NOT NULL,
    "expert_profile_id" UUID NOT NULL,
    "media_url" TEXT NOT NULL,
    "link_url" TEXT,
    "text" TEXT,
    "target_category_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expert_banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_blocks" (
    "id" UUID NOT NULL,
    "blocker_user_id" UUID NOT NULL,
    "blocked_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "conversation_reports" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "reporter_user_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "zego_callback_logs" (
    "id" UUID NOT NULL,
    "event" VARCHAR(64) NOT NULL,
    "room_id" VARCHAR(128),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zego_callback_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "faqs_is_active_idx" ON "faqs"("is_active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "expert_banners_expert_profile_id_idx" ON "expert_banners"("expert_profile_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "expert_banners_is_active_idx" ON "expert_banners"("is_active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_blocks_blocked_user_id_idx" ON "user_blocks"("blocked_user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_blocks_blocker_user_id_blocked_user_id_key" ON "user_blocks"("blocker_user_id", "blocked_user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversation_reports_conversation_id_idx" ON "conversation_reports"("conversation_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversation_reports_reporter_user_id_idx" ON "conversation_reports"("reporter_user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "zego_callback_logs_room_id_idx" ON "zego_callback_logs"("room_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "zego_callback_logs_event_idx" ON "zego_callback_logs"("event");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users"("email");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_attachment_id_fkey') THEN
        ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expert_banners_expert_profile_id_fkey') THEN
        ALTER TABLE "expert_banners" ADD CONSTRAINT "expert_banners_expert_profile_id_fkey" FOREIGN KEY ("expert_profile_id") REFERENCES "expert_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_blocks_blocker_user_id_fkey') THEN
        ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_user_id_fkey" FOREIGN KEY ("blocker_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_blocks_blocked_user_id_fkey') THEN
        ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_user_id_fkey" FOREIGN KEY ("blocked_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_reports_conversation_id_fkey') THEN
        ALTER TABLE "conversation_reports" ADD CONSTRAINT "conversation_reports_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_reports_reporter_user_id_fkey') THEN
        ALTER TABLE "conversation_reports" ADD CONSTRAINT "conversation_reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

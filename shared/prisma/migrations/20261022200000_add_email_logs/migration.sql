-- CreateEnum
CREATE TYPE "email_log_status" AS ENUM ('sent', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "email_logs" (
    "id" UUID NOT NULL,
    "to_email" VARCHAR(998) NOT NULL,
    "from_email" VARCHAR(320),
    "subject" TEXT NOT NULL,
    "category" VARCHAR(64) NOT NULL DEFAULT 'general',
    "status" "email_log_status" NOT NULL,
    "provider" VARCHAR(32) NOT NULL DEFAULT 'sendgrid',
    "provider_message_id" VARCHAR(128),
    "error_message" TEXT,
    "html_body" TEXT,
    "text_body" TEXT,
    "service" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_logs_created_at_idx" ON "email_logs"("created_at");
CREATE INDEX "email_logs_to_email_idx" ON "email_logs"("to_email");
CREATE INDEX "email_logs_status_created_at_idx" ON "email_logs"("status", "created_at");
CREATE INDEX "email_logs_category_created_at_idx" ON "email_logs"("category", "created_at");

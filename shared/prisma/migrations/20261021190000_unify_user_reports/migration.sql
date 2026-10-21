-- AlterTable
ALTER TABLE "expert_reports" ADD COLUMN "source" VARCHAR(32) NOT NULL DEFAULT 'expert_profile',
ADD COLUMN "conversation_id" UUID;

-- CreateTable
CREATE TABLE "customer_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "expert_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "reason" VARCHAR(120) NOT NULL,
    "details" TEXT,
    "status" "expert_report_status" NOT NULL DEFAULT 'open',
    "source" VARCHAR(32) NOT NULL DEFAULT 'chat',
    "conversation_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_reports_customer_id_idx" ON "customer_reports"("customer_id");
CREATE INDEX "customer_reports_status_idx" ON "customer_reports"("status");

-- AddForeignKey
ALTER TABLE "customer_reports" ADD CONSTRAINT "customer_reports_expert_id_fkey" FOREIGN KEY ("expert_id") REFERENCES "expert_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_reports" ADD CONSTRAINT "customer_reports_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: customer -> expert chat reports become expert reports.
-- Legacy "Other: <text>" reasons are split into reason + details.
INSERT INTO "expert_reports" ("id", "customer_id", "expert_id", "reason", "details", "source", "conversation_id", "created_at", "updated_at")
SELECT gen_random_uuid(), c."customer_id", c."expert_id",
       CASE WHEN r."reason" LIKE 'Other: %' THEN 'Other' ELSE LEFT(r."reason", 120) END,
       CASE WHEN r."reason" LIKE 'Other: %' THEN SUBSTRING(r."reason" FROM 8) ELSE NULL END,
       'chat', c."id", r."created_at", r."created_at"
FROM "conversation_reports" r
JOIN "conversations" c ON c."id" = r."conversation_id"
JOIN "customer_profiles" cp ON cp."id" = c."customer_id" AND cp."user_id" = r."reporter_user_id";

-- Backfill: expert -> customer chat reports.
INSERT INTO "customer_reports" ("id", "expert_id", "customer_id", "reason", "details", "source", "conversation_id", "created_at", "updated_at")
SELECT gen_random_uuid(), c."expert_id", c."customer_id",
       CASE WHEN r."reason" LIKE 'Other: %' THEN 'Other' ELSE LEFT(r."reason", 120) END,
       CASE WHEN r."reason" LIKE 'Other: %' THEN SUBSTRING(r."reason" FROM 8) ELSE NULL END,
       'chat', c."id", r."created_at", r."created_at"
FROM "conversation_reports" r
JOIN "conversations" c ON c."id" = r."conversation_id"
JOIN "expert_profiles" ep ON ep."id" = c."expert_id" AND ep."user_id" = r."reporter_user_id";

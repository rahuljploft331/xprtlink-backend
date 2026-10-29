-- CreateTable
CREATE TABLE "review_reports" (
    "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
    "review_id"            UUID NOT NULL,
    "reporter_role"        VARCHAR(16) NOT NULL,
    "reporter_customer_id" UUID,
    "reporter_expert_id"   UUID,
    "reason"               VARCHAR(120) NOT NULL,
    "details"              TEXT,
    "status"               "expert_report_status" NOT NULL DEFAULT 'open',
    "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_reports_review_id_reporter_customer_id_key" ON "review_reports"("review_id", "reporter_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_reports_review_id_reporter_expert_id_key" ON "review_reports"("review_id", "reporter_expert_id");

-- CreateIndex
CREATE INDEX "review_reports_status_idx" ON "review_reports"("status");

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_id_fkey"
    FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_reporter_customer_id_fkey"
    FOREIGN KEY ("reporter_customer_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_reporter_expert_id_fkey"
    FOREIGN KEY ("reporter_expert_id") REFERENCES "expert_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

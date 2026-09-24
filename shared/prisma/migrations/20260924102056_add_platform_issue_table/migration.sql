-- CreateEnum
CREATE TYPE "platform_issue_status" AS ENUM ('open', 'in_progress', 'resolved', 'closed');

-- CreateTable
CREATE TABLE "platform_issues" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "urgency" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "platform_issue_status" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platform_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_issues_user_id_idx" ON "platform_issues"("user_id");

-- CreateIndex
CREATE INDEX "platform_issues_status_idx" ON "platform_issues"("status");

-- AddForeignKey
ALTER TABLE "platform_issues" ADD CONSTRAINT "platform_issues_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

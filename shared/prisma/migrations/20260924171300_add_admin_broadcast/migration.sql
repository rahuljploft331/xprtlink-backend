-- CreateTable
CREATE TABLE "admin_broadcasts" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "audience" VARCHAR(64) NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "status" VARCHAR(64) NOT NULL DEFAULT 'draft',
    "scheduled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_broadcasts_pkey" PRIMARY KEY ("id")
);

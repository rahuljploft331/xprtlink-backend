-- CreateTable
CREATE TABLE "support_ticket_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_ticket_attachments_ticket_id_media_id_key" ON "support_ticket_attachments"("ticket_id", "media_id");

-- CreateIndex
CREATE INDEX "support_ticket_attachments_media_id_idx" ON "support_ticket_attachments"("media_id");

-- AddForeignKey
ALTER TABLE "support_ticket_attachments" ADD CONSTRAINT "support_ticket_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_attachments" ADD CONSTRAINT "support_ticket_attachments_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill existing support_tickets with attachment_id into support_ticket_attachments
INSERT INTO "support_ticket_attachments" ("ticket_id", "media_id")
SELECT "id", "attachment_id"
FROM "support_tickets"
WHERE "attachment_id" IS NOT NULL
ON CONFLICT DO NOTHING;

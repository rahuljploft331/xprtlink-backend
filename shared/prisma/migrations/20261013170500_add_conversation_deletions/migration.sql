-- CreateTable
CREATE TABLE "conversation_deletions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_id" UUID,

    CONSTRAINT "conversation_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_deletions_conversation_id_user_id_key" ON "conversation_deletions"("conversation_id", "user_id");

-- CreateIndex
CREATE INDEX "conversation_deletions_user_id_idx" ON "conversation_deletions"("user_id");

-- CreateIndex
CREATE INDEX "conversation_deletions_conversation_id_idx" ON "conversation_deletions"("conversation_id");

-- AddForeignKey
ALTER TABLE "conversation_deletions" ADD CONSTRAINT "conversation_deletions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_deletions" ADD CONSTRAINT "conversation_deletions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_deletions" ADD CONSTRAINT "conversation_deletions_last_message_id_fkey" FOREIGN KEY ("last_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

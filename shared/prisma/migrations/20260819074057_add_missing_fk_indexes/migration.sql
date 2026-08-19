-- CreateIndex
CREATE INDEX "customer_profiles_avatar_media_id_idx" ON "customer_profiles"("avatar_media_id");

-- CreateIndex
CREATE INDEX "expert_subscriptions_plan_id_idx" ON "expert_subscriptions"("plan_id");

-- CreateIndex
CREATE INDEX "expert_verification_documents_media_id_idx" ON "expert_verification_documents"("media_id");

-- CreateIndex
CREATE INDEX "message_attachments_media_id_idx" ON "message_attachments"("media_id");

-- CreateIndex
CREATE INDEX "messages_sender_user_id_idx" ON "messages"("sender_user_id");

-- CreateIndex
CREATE INDEX "quote_attachments_media_id_idx" ON "quote_attachments"("media_id");

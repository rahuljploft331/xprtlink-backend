-- Phase 4: Webhook event deduplication table
-- Prevents duplicate processing of Stripe webhook retries.

CREATE TABLE "processed_webhook_events" (
    "id" VARCHAR(128) NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "processed_webhook_events_processed_at_idx" ON "processed_webhook_events"("processed_at");

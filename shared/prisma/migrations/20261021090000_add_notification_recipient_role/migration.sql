-- Scope notifications and device sessions to a role.
--
-- A single email can hold BOTH a customer and an expert profile on one `users`
-- row (user-service reuses the row and attaches the missing profile), so
-- `user_id` alone never identified a feed. Every read path now also filters on
-- `recipient_role`, and pushes only reach device tokens registered for that role.
--
-- 'all' means "visible to both": legacy rows that cannot be resolved, and
-- genuine admin broadcasts.

-- CreateEnum
CREATE TYPE "notification_audience" AS ENUM ('customer', 'expert', 'all');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "recipient_role" "notification_audience" NOT NULL DEFAULT 'all';

-- AlterTable
ALTER TABLE "device_tokens" ADD COLUMN "role" "notification_audience" NOT NULL DEFAULT 'all';

-- CreateIndex
CREATE INDEX "notifications_user_id_recipient_role_created_at_idx" ON "notifications"("user_id", "recipient_role", "created_at" DESC);

-- ───────────────────────── Backfill ─────────────────────────

-- 1. Types that only ever target an expert.
UPDATE "notifications" SET "recipient_role" = 'expert'
WHERE "type" IN (
  'quote_received', 'quote_accepted', 'quote_cancelled', 'review_received',
  'subscription_activated', 'subscription_cancelled', 'subscription_expired',
  'payout_sent', 'verification_approved', 'verification_rejected'
);

-- 2. Types that only ever target a customer.
UPDATE "notifications" SET "recipient_role" = 'customer'
WHERE "type" IN (
  'quote_submitted', 'consultation_accepted', 'consultation_declined',
  'payment_failed', 'payment_refunded'
);

-- 3. Dual-role types (quote_rejected, payment_succeeded, new_message) carry the
--    entity in their payload. Join through it and compare which side's profile
--    belongs to this user. This is what resolves rows for dual-role accounts,
--    where the single-profile shortcut in step 4 cannot help.

-- 3a. payload.quoteId -> quote_requests
UPDATE "notifications" n SET "recipient_role" = 'customer'
FROM "quote_requests" q
JOIN "customer_profiles" cp ON cp."id" = q."customer_id"
WHERE n."recipient_role" = 'all'
  AND n."payload"->>'quoteId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND q."id" = (n."payload"->>'quoteId')::uuid
  AND cp."user_id" = n."user_id";

UPDATE "notifications" n SET "recipient_role" = 'expert'
FROM "quote_requests" q
JOIN "expert_profiles" ep ON ep."id" = q."expert_id"
WHERE n."recipient_role" = 'all'
  AND n."payload"->>'quoteId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND q."id" = (n."payload"->>'quoteId')::uuid
  AND ep."user_id" = n."user_id";

-- 3b. payload.consultationId -> consultations  (covers payment_succeeded)
UPDATE "notifications" n SET "recipient_role" = 'customer'
FROM "consultations" c
JOIN "customer_profiles" cp ON cp."id" = c."customer_id"
WHERE n."recipient_role" = 'all'
  AND n."payload"->>'consultationId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND c."id" = (n."payload"->>'consultationId')::uuid
  AND cp."user_id" = n."user_id";

UPDATE "notifications" n SET "recipient_role" = 'expert'
FROM "consultations" c
JOIN "expert_profiles" ep ON ep."id" = c."expert_id"
WHERE n."recipient_role" = 'all'
  AND n."payload"->>'consultationId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND c."id" = (n."payload"->>'consultationId')::uuid
  AND ep."user_id" = n."user_id";

-- 3c. payload.conversationId -> conversations  (covers new_message)
UPDATE "notifications" n SET "recipient_role" = 'customer'
FROM "conversations" cv
JOIN "customer_profiles" cp ON cp."id" = cv."customer_id"
WHERE n."recipient_role" = 'all'
  AND n."payload"->>'conversationId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND cv."id" = (n."payload"->>'conversationId')::uuid
  AND cp."user_id" = n."user_id";

UPDATE "notifications" n SET "recipient_role" = 'expert'
FROM "conversations" cv
JOIN "expert_profiles" ep ON ep."id" = cv."expert_id"
WHERE n."recipient_role" = 'all'
  AND n."payload"->>'conversationId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND cv."id" = (n."payload"->>'conversationId')::uuid
  AND ep."user_id" = n."user_id";

-- 4. Anything from a dual-role type still unresolved (payload had no usable id,
--    e.g. quote_expired dispatches an empty payload): if the user holds only one
--    profile, the role is unambiguous. Broadcast/system types are left as 'all'
--    on purpose.
UPDATE "notifications" n SET "recipient_role" = 'customer'
WHERE n."recipient_role" = 'all'
  AND n."type" IN ('quote_rejected', 'quote_expired', 'payment_succeeded', 'new_message')
  AND EXISTS (SELECT 1 FROM "customer_profiles" cp WHERE cp."user_id" = n."user_id")
  AND NOT EXISTS (SELECT 1 FROM "expert_profiles" ep WHERE ep."user_id" = n."user_id");

UPDATE "notifications" n SET "recipient_role" = 'expert'
WHERE n."recipient_role" = 'all'
  AND n."type" IN ('quote_rejected', 'quote_expired', 'payment_succeeded', 'new_message')
  AND EXISTS (SELECT 1 FROM "expert_profiles" ep WHERE ep."user_id" = n."user_id")
  AND NOT EXISTS (SELECT 1 FROM "customer_profiles" cp WHERE cp."user_id" = n."user_id");

-- 5. Device tokens: a single-profile user's device can only be that role.
--    Dual-role devices stay 'all' and self-correct on the next login, because
--    the app re-registers its token on every login and at startup.
UPDATE "device_tokens" d SET "role" = 'customer'
WHERE d."role" = 'all'
  AND EXISTS (SELECT 1 FROM "customer_profiles" cp WHERE cp."user_id" = d."user_id")
  AND NOT EXISTS (SELECT 1 FROM "expert_profiles" ep WHERE ep."user_id" = d."user_id");

UPDATE "device_tokens" d SET "role" = 'expert'
WHERE d."role" = 'all'
  AND EXISTS (SELECT 1 FROM "expert_profiles" ep WHERE ep."user_id" = d."user_id")
  AND NOT EXISTS (SELECT 1 FROM "customer_profiles" cp WHERE cp."user_id" = d."user_id");

-- Add free-form customer notes to quote requests.
-- Idempotent guard: the column may already exist in environments that were
-- synced via `prisma db push` before this migration was authored.
ALTER TABLE "quote_requests"
  ADD COLUMN IF NOT EXISTS "notes" TEXT;

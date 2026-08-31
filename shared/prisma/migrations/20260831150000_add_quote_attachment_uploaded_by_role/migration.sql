-- Distinguish quote attachments uploaded by the customer (the request files)
-- from those uploaded by the expert alongside their quotation.

-- New enum for the attachment author role.
CREATE TYPE "quote_attachment_role" AS ENUM ('customer', 'expert');

-- Existing attachments were all uploaded by the customer, so default to
-- 'customer' and backfill existing rows via that default.
ALTER TABLE "quote_attachments"
  ADD COLUMN "uploaded_by_role" "quote_attachment_role" NOT NULL DEFAULT 'customer';

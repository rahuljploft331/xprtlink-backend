-- Add raw_password to admin_users table for subadmin accounts
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "raw_password" VARCHAR(255);

-- Backfill default seed subadmin passwords
UPDATE "admin_users"
   SET "raw_password" = 'Support@123'
 WHERE "email" = 'support@xpertlink.local' AND "role" = 'subadmin' AND "raw_password" IS NULL;

UPDATE "admin_users"
   SET "raw_password" = 'Finance@123'
 WHERE "email" = 'finance@xpertlink.local' AND "role" = 'subadmin' AND "raw_password" IS NULL;

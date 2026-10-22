-- Replace plaintext raw_password with an app-encrypted column (AES-256-GCM, key in env).
-- Existing plaintext values are dropped; subadmins must reset/change their password to be viewable again.
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "password_encrypted" TEXT;
ALTER TABLE "admin_users" DROP COLUMN IF EXISTS "raw_password";

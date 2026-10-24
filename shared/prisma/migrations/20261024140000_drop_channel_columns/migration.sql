-- Web-only pricing keeps just web_price_monthly_cents / web_trial_days; the per-channel
-- visibility columns are removed so mobile plan listing and IAP behave exactly as before.
DROP INDEX IF EXISTS "subscription_plans_store_product_id_key";
ALTER TABLE "subscription_plans" DROP COLUMN IF EXISTS "store_product_id";
ALTER TABLE "subscription_plans" DROP COLUMN IF EXISTS "available_on_web";
ALTER TABLE "subscription_plans" DROP COLUMN IF EXISTS "available_on_app";

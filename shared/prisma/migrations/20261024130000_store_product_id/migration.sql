-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN "store_product_id" VARCHAR(128);

-- Existing plans already use their code as the store product ID.
UPDATE "subscription_plans" SET "store_product_id" = "code" WHERE "available_on_app" = true;

ALTER TABLE "subscription_plans" DROP COLUMN "available_on_app";

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_store_product_id_key" ON "subscription_plans"("store_product_id");

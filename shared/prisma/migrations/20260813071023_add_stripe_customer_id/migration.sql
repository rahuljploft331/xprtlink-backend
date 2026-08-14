/*
  Warnings:

  - A unique constraint covering the columns `[stripe_customer_id]` on the table `customer_profiles` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "customer_profiles" ADD COLUMN     "stripe_customer_id" VARCHAR(128);

-- AlterTable
ALTER TABLE "expert_subscriptions" ADD COLUMN     "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN     "stripe_price_id" VARCHAR(128),
ADD COLUMN     "stripe_product_id" VARCHAR(128);

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_stripe_customer_id_key" ON "customer_profiles"("stripe_customer_id");

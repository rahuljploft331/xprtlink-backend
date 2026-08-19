-- DropForeignKey
ALTER TABLE "consultations" DROP CONSTRAINT "consultations_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "consultations" DROP CONSTRAINT "consultations_expert_id_fkey";

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_expert_id_fkey" FOREIGN KEY ("expert_id") REFERENCES "expert_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

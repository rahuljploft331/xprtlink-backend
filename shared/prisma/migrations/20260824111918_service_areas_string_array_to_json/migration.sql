/*
  Warnings:

  - The `service_areas` column on the `expert_profiles` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "expert_profiles" DROP COLUMN "service_areas",
ADD COLUMN     "service_areas" JSONB NOT NULL DEFAULT '[]';

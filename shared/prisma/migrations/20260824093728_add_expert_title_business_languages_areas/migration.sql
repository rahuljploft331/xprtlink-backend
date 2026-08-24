-- AlterTable
ALTER TABLE "expert_profiles" ADD COLUMN     "business_name" VARCHAR(200),
ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "service_areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "title" VARCHAR(200);

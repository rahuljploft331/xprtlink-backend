-- AlterTable
ALTER TABLE "_ExpertCategories" ADD CONSTRAINT "_ExpertCategories_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_ExpertCategories_AB_unique";

-- AlterTable
ALTER TABLE "consultations" ADD COLUMN     "joined_participant_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "note" VARCHAR(1000),
ADD COLUMN     "title" VARCHAR(200);

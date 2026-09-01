-- Migrate ExpertProfile.categoryId (single scalar FK) to a many-to-many
-- relation (`categories`) backed by Prisma's implicit join table.
--
-- Every expert currently has exactly one category (category_id NOT NULL).
-- We create the join table, backfill each expert's single category into it,
-- then drop the old scalar column / FK / index.

-- 1. Create Prisma implicit M:N join table for relation "ExpertCategories".
--    Column A -> Category.id, Column B -> ExpertProfile.id (alphabetical model order).
CREATE TABLE "_ExpertCategories" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL
);

-- 2. Backfill: each expert's existing single category becomes one join row.
INSERT INTO "_ExpertCategories" ("A", "B")
SELECT "category_id", "id"
FROM "expert_profiles"
WHERE "category_id" IS NOT NULL;

-- 3. Indexes/constraints Prisma expects on an implicit join table.
CREATE UNIQUE INDEX "_ExpertCategories_AB_unique" ON "_ExpertCategories"("A", "B");
CREATE INDEX "_ExpertCategories_B_index" ON "_ExpertCategories"("B");

ALTER TABLE "_ExpertCategories"
  ADD CONSTRAINT "_ExpertCategories_A_fkey"
  FOREIGN KEY ("A") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_ExpertCategories"
  ADD CONSTRAINT "_ExpertCategories_B_fkey"
  FOREIGN KEY ("B") REFERENCES "expert_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Drop the old scalar FK, index, and column.
ALTER TABLE "expert_profiles" DROP CONSTRAINT "expert_profiles_category_id_fkey";
DROP INDEX "expert_profiles_category_id_idx";
ALTER TABLE "expert_profiles" DROP COLUMN "category_id";

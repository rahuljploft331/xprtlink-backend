-- Prisma 6 implicit M2M tables use a composite PK instead of a unique index.
-- Production `_ExpertCategories` may already have that PK (db push / Prisma 6
-- table create), so adding it blindly fails with 42P16 and aborts the whole
-- transaction — including the consultation columns below.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = '_ExpertCategories'
      AND c.contype = 'p'
  ) THEN
    ALTER TABLE "_ExpertCategories"
      ADD CONSTRAINT "_ExpertCategories_AB_pkey" PRIMARY KEY ("A", "B");
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tbl.relnamespace
    WHERE n.nspname = 'public'
      AND tbl.relname = '_ExpertCategories'
      AND idx.relname = '_ExpertCategories_AB_unique'
      AND NOT i.indisprimary
  ) THEN
    DROP INDEX "_ExpertCategories_AB_unique";
  END IF;
END $$;

ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "joined_participant_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "note" VARCHAR(1000);
ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "title" VARCHAR(200);

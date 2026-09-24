-- AlterEnum
ALTER TYPE "media_purpose" ADD VALUE 'support_attachment';

-- AlterTable
ALTER TABLE "faqs" ADD COLUMN     "type" VARCHAR(32) NOT NULL DEFAULT 'customer';

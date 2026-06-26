-- Resolution reason on a resolved thread (F7): why it was closed.
-- Nullable; FIXED | WONTFIX | OBSOLETE (see lib/enums.ts RESOLUTIONS).
-- AlterTable
ALTER TABLE "Annotation" ADD COLUMN "resolution" TEXT;

-- Idempotent plan creation (F6): a client-supplied key, unique per owner.
-- Nullable; SQLite treats NULLs as distinct in a unique index, so existing
-- rows (all NULL) do not collide.
-- AlterTable
ALTER TABLE "Document" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Document_ownerId_idempotencyKey_key" ON "Document"("ownerId", "idempotencyKey");

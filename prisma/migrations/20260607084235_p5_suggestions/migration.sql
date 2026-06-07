-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Annotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "createdOnVersionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COMMENT',
    "anchorExact" TEXT,
    "anchorPrefix" TEXT,
    "anchorSuffix" TEXT,
    "startOffset" INTEGER,
    "endOffset" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "threadStatus" TEXT NOT NULL DEFAULT 'OPEN',
    "severity" TEXT,
    "category" TEXT,
    "authorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suggestedText" TEXT,
    "appliedInVersionId" TEXT,
    CONSTRAINT "Annotation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Annotation_createdOnVersionId_fkey" FOREIGN KEY ("createdOnVersionId") REFERENCES "DocumentVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Annotation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Annotation_appliedInVersionId_fkey" FOREIGN KEY ("appliedInVersionId") REFERENCES "DocumentVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Annotation" ("anchorExact", "anchorPrefix", "anchorSuffix", "authorId", "category", "createdAt", "createdOnVersionId", "documentId", "endOffset", "id", "kind", "severity", "startOffset", "status", "threadStatus") SELECT "anchorExact", "anchorPrefix", "anchorSuffix", "authorId", "category", "createdAt", "createdOnVersionId", "documentId", "endOffset", "id", "kind", "severity", "startOffset", "status", "threadStatus" FROM "Annotation";
DROP TABLE "Annotation";
ALTER TABLE "new_Annotation" RENAME TO "Annotation";
CREATE INDEX "Annotation_documentId_idx" ON "Annotation"("documentId");
CREATE INDEX "Annotation_createdOnVersionId_idx" ON "Annotation"("createdOnVersionId");
CREATE INDEX "Annotation_authorId_idx" ON "Annotation"("authorId");
CREATE INDEX "Annotation_appliedInVersionId_idx" ON "Annotation"("appliedInVersionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

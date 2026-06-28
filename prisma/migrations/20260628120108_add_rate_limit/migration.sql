-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT,
    "count" INTEGER,
    "lastRequest" BIGINT
);

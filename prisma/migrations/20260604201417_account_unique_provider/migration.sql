/*
  Warnings:

  - A unique constraint covering the columns `[accountId,providerId]` on the table `Account` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Account_accountId_providerId_key" ON "Account"("accountId", "providerId");

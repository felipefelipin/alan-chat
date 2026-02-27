/*
  Warnings:

  - You are about to drop the column `paidAt` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `plan` on the `Payment` table. All the data in the column will be lost.
  - Added the required column `plano` to the `Payment` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Payment_preferenceId_key";

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "paidAt",
DROP COLUMN "plan",
ADD COLUMN     "initPoint" TEXT,
ADD COLUMN     "plano" TEXT NOT NULL,
ALTER COLUMN "status" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "etapa" SET DEFAULT 'pre_start';

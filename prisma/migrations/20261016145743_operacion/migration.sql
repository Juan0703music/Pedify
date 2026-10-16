-- CreateEnum
CREATE TYPE "SalesPolicy" AS ENUM ('ACCEPTED', 'DELIVERED', 'PAID');

-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "sales_policy" "SalesPolicy" NOT NULL DEFAULT 'ACCEPTED';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paid_at" TIMESTAMPTZ(3);

-- AlterEnum
ALTER TYPE "DeliveryType" ADD VALUE 'DINE_IN';

-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "dine_in_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "table_number" TEXT;

-- Escrito a mano: el número o nombre de la mesa es corto («4», «Terraza 2»).
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_number_check" CHECK ("table_number" IS NULL OR char_length("table_number") BETWEEN 1 AND 20);

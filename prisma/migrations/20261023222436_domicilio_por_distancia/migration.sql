-- CreateEnum
CREATE TYPE "DeliveryPricing" AS ENUM ('FIXED', 'DISTANCE');

-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "delivery_pricing" "DeliveryPricing" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "delivery_tiers" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "location_lat" DOUBLE PRECISION,
ADD COLUMN     "location_lng" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivery_distance_m" INTEGER;

-- Escritos a mano: la ubicación del negocio va completa y dentro del rango; la distancia nunca es negativa.
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_location_check" CHECK (
  ("location_lat" IS NULL AND "location_lng" IS NULL)
  OR ("location_lat" BETWEEN -90 AND 90 AND "location_lng" BETWEEN -180 AND 180)
);
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_distance_check" CHECK ("delivery_distance_m" IS NULL OR "delivery_distance_m" >= 0);

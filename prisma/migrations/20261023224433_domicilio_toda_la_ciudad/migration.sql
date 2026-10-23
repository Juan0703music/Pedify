-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "delivery_extra_km_fee" INTEGER,
ADD COLUMN     "delivery_max_km" DOUBLE PRECISION;

-- Escritos a mano: valores en pesos no negativos y una distancia máxima razonable (hasta 50 km).
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_delivery_distance_check" CHECK (
  ("delivery_extra_km_fee" IS NULL OR "delivery_extra_km_fee" >= 0)
  AND ("delivery_max_km" IS NULL OR ("delivery_max_km" > 0 AND "delivery_max_km" <= 50))
);

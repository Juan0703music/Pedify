-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivery_lat" DOUBLE PRECISION,
ADD COLUMN     "delivery_lng" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "courier_tracking" (
    "order_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracy" INTEGER,
    "heading" DOUBLE PRECISION,
    "updated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "courier_tracking_pkey" PRIMARY KEY ("order_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "courier_tracking_token_hash_key" ON "courier_tracking"("token_hash");

-- CreateIndex
CREATE INDEX "courier_tracking_business_id_idx" ON "courier_tracking"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "courier_tracking_order_id_business_id_key" ON "courier_tracking"("order_id", "business_id");

-- AddForeignKey
ALTER TABLE "courier_tracking" ADD CONSTRAINT "courier_tracking_order_id_business_id_fkey" FOREIGN KEY ("order_id", "business_id") REFERENCES "orders"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_tracking" ADD CONSTRAINT "courier_tracking_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Coordenadas válidas (escritas a mano: Prisma no genera CHECK).
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_point_check" CHECK (
  ("delivery_lat" IS NULL AND "delivery_lng" IS NULL)
  OR ("delivery_lat" BETWEEN -90 AND 90 AND "delivery_lng" BETWEEN -180 AND 180)
);
ALTER TABLE "courier_tracking" ADD CONSTRAINT "courier_tracking_point_check" CHECK (
  ("lat" IS NULL AND "lng" IS NULL)
  OR ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180)
);
ALTER TABLE "courier_tracking" ADD CONSTRAINT "courier_tracking_accuracy_check" CHECK ("accuracy" IS NULL OR "accuracy" >= 0);

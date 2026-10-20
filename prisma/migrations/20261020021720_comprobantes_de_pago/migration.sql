-- CreateTable
CREATE TABLE "payment_proofs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "order_id" UUID,
    "image_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_proofs_business_id_created_at_idx" ON "payment_proofs"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_proofs_order_id_business_id_key" ON "payment_proofs"("order_id", "business_id");

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_order_id_business_id_fkey" FOREIGN KEY ("order_id", "business_id") REFERENCES "orders"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

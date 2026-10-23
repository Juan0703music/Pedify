-- CreateEnum
CREATE TYPE "PlanCheckoutStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR');

-- CreateTable
CREATE TABLE "plan_checkouts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "plan" "PlanCode" NOT NULL,
    "months" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "PlanCheckoutStatus" NOT NULL DEFAULT 'PENDING',
    "transaction_id" TEXT,
    "payment_method" TEXT,
    "payment_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plan_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_checkouts_payment_id_key" ON "plan_checkouts"("payment_id");

-- CreateIndex
CREATE INDEX "plan_checkouts_business_id_created_at_idx" ON "plan_checkouts"("business_id", "created_at");

-- AddForeignKey
ALTER TABLE "plan_checkouts" ADD CONSTRAINT "plan_checkouts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_checkouts" ADD CONSTRAINT "plan_checkouts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "subscription_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_checkouts" ADD CONSTRAINT "plan_checkouts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

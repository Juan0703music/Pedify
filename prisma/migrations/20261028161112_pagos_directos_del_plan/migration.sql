-- CreateEnum
CREATE TYPE "PlanTransferStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "platform_payment_accounts" (
    "kind" "PaymentAccountKind" NOT NULL,
    "account_key" TEXT,
    "holder_name" TEXT,
    "qr_payload" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_payment_accounts_pkey" PRIMARY KEY ("kind")
);

-- CreateTable
CREATE TABLE "plan_transfers" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "plan" "PlanCode" NOT NULL,
    "months" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentAccountKind" NOT NULL,
    "status" "PlanTransferStatus" NOT NULL DEFAULT 'PENDING',
    "image_key" TEXT NOT NULL,
    "image_hash" TEXT,
    "receipt_text" TEXT,
    "read_at" TIMESTAMPTZ(3),
    "reference" TEXT,
    "check_status" "ProofCheckStatus" NOT NULL DEFAULT 'PENDING',
    "checks" JSONB NOT NULL DEFAULT '[]',
    "reject_reason" TEXT,
    "created_by_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "payment_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plan_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_transfers_payment_id_key" ON "plan_transfers"("payment_id");

-- CreateIndex
CREATE INDEX "plan_transfers_status_created_at_idx" ON "plan_transfers"("status", "created_at");

-- CreateIndex
CREATE INDEX "plan_transfers_business_id_created_at_idx" ON "plan_transfers"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "plan_transfers_reference_idx" ON "plan_transfers"("reference");

-- CreateIndex
CREATE INDEX "plan_transfers_image_hash_idx" ON "plan_transfers"("image_hash");

-- AddForeignKey
ALTER TABLE "plan_transfers" ADD CONSTRAINT "plan_transfers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_transfers" ADD CONSTRAINT "plan_transfers_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "subscription_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_transfers" ADD CONSTRAINT "plan_transfers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_transfers" ADD CONSTRAINT "plan_transfers_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

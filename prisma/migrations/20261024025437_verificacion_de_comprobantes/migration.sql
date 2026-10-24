-- CreateEnum
CREATE TYPE "ProofCheckStatus" AS ENUM ('PENDING', 'VERIFIED', 'REVIEW', 'MISMATCH');

-- AlterTable
ALTER TABLE "payment_proofs" ADD COLUMN     "check_status" "ProofCheckStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "checks" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "image_hash" TEXT,
ADD COLUMN     "read_at" TIMESTAMPTZ(3),
ADD COLUMN     "receipt_text" TEXT,
ADD COLUMN     "reference" TEXT;

-- CreateIndex
CREATE INDEX "payment_proofs_business_id_reference_idx" ON "payment_proofs"("business_id", "reference");

-- Los comprobantes que ya existían no se leyeron: quedan para revisarlos como antes.
UPDATE "payment_proofs" SET "check_status" = 'REVIEW';

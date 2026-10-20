-- CreateEnum
CREATE TYPE "PaymentAccountKind" AS ENUM ('NEQUI', 'BRE_B', 'DAVIPLATA');

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "PaymentAccountKind" NOT NULL,
    "account_key" TEXT,
    "holder_name" TEXT,
    "qr_payload" TEXT,
    "qr_image_url" TEXT,
    "qr_image_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_accounts_business_id_kind_key" ON "payment_accounts"("business_id", "kind");

-- AddForeignKey
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Límites de los textos (escritos a mano: Prisma no genera CHECK).
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_lengths_check" CHECK (
  ("account_key" IS NULL OR char_length("account_key") BETWEEN 3 AND 80)
  AND ("holder_name" IS NULL OR char_length("holder_name") BETWEEN 2 AND 80)
  AND ("qr_payload" IS NULL OR char_length("qr_payload") BETWEEN 1 AND 1000)
);

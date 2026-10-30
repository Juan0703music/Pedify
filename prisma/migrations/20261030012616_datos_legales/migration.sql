-- CreateEnum
CREATE TYPE "IdDocumentType" AS ENUM ('CC', 'NIT', 'CE', 'PPT', 'PA');

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "id_number" TEXT,
ADD COLUMN     "id_type" "IdDocumentType",
ADD COLUMN     "legal_name" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "terms_accepted_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "platform_legal" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "legal_name" TEXT NOT NULL,
    "id_type" "IdDocumentType" NOT NULL,
    "id_number" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_legal_pkey" PRIMARY KEY ("id")
);

-- Una sola fila con los datos de Pedify.
ALTER TABLE "platform_legal" ADD CONSTRAINT "platform_legal_single_row" CHECK ("id" = 1);

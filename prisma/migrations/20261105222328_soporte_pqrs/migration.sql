-- CreateEnum
CREATE TYPE "SupportKind" AS ENUM ('CONSULTA', 'PETICION', 'QUEJA', 'RECLAMO', 'SUGERENCIA');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportAuthor" AS ENUM ('REQUESTER', 'PEDIFY');

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "kind" "SupportKind" NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "user_id" UUID,
    "business_id" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "access_key" TEXT,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "last_message_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requester_seen_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author" "SupportAuthor" NOT NULL,
    "user_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_access_key_key" ON "support_tickets"("access_key");

-- CreateIndex
CREATE INDEX "support_tickets_status_last_message_at_idx" ON "support_tickets"("status", "last_message_at");

-- CreateIndex
CREATE INDEX "support_tickets_user_id_last_message_at_idx" ON "support_tickets"("user_id", "last_message_at");

-- CreateIndex
CREATE INDEX "support_messages_ticket_id_created_at_idx" ON "support_messages"("ticket_id", "created_at");

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

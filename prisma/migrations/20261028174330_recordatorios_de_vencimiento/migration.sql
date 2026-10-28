-- CreateEnum
CREATE TYPE "RenewalReminder" AS ENUM ('DAYS_5', 'DAY_1', 'EXPIRED');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "reminder_ends_at" TIMESTAMPTZ(3),
ADD COLUMN     "reminder_stage" "RenewalReminder";

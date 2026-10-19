-- AlterTable
ALTER TABLE "business_memberships" ADD COLUMN     "can_mark_sold_out" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "can_view_analytics" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "can_view_customers" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "can_view_sales" BOOLEAN NOT NULL DEFAULT true;

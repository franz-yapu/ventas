ALTER TABLE "product" ADD COLUMN "cost_wholesale" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "sale_item" ADD COLUMN "unit_cost_snapshot" numeric(12, 2);
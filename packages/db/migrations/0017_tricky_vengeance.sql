ALTER TABLE "subscription" ADD COLUMN "billing_months" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "billed_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "cycle_started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_register_user_idx" ON "cash_register" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_register_closed_by_idx" ON "cash_register" USING btree ("closed_by");
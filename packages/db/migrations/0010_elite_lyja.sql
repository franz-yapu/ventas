CREATE TYPE "public"."cash_movement_type" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cash_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"cash_register_id" uuid NOT NULL,
	"user_id" uuid,
	"type" "cash_movement_type" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_register" ADD COLUMN "closed_by" uuid;--> statement-breakpoint
ALTER TABLE "cash_register" ADD COLUMN "notes" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_cash_register_id_cash_register_id_fk" FOREIGN KEY ("cash_register_id") REFERENCES "public"."cash_register"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_movement_register_idx" ON "cash_movement" USING btree ("cash_register_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_register" ADD CONSTRAINT "cash_register_closed_by_app_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_register_location_idx" ON "cash_register" USING btree ("location_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cash_register_una_abierta_uq" ON "cash_register" USING btree ("location_id") WHERE closed_at is null;
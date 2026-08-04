CREATE TYPE "public"."subscription_status" AS ENUM('trial', 'active', 'past_due', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_monthly" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'BOB' NOT NULL,
	"max_locations" integer,
	"max_users" integer,
	"max_products" integer,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"plan_code" text NOT NULL,
	"status" "subscription_status" DEFAULT 'trial' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"suspended_reason" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription" ADD CONSTRAINT "subscription_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription" ADD CONSTRAINT "subscription_plan_code_plan_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."plan"("code") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

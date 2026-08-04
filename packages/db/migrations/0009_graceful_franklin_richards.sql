CREATE TYPE "public"."auth_token_purpose" AS ENUM('password_reset', 'email_verify');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "auth_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_token" ADD CONSTRAINT "auth_token_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_token" ADD CONSTRAINT "auth_token_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_token_user_idx" ON "auth_token" USING btree ("user_id","purpose");--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_business_email_uq" UNIQUE("business_id","email");
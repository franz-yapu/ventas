ALTER TABLE "business" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "sku_prefix" text DEFAULT 'P' NOT NULL;--> statement-breakpoint
ALTER TABLE "business" ADD CONSTRAINT "business_slug_unique" UNIQUE("slug");
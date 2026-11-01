-- ADR-0021: curated, indicative listings for buses, trains and stays. Hand-written like 0003-0016; the journal entry is added by hand.
-- Permission listings.write was granted to admin and owner in 0015. A price can only exist together with price_quoted.
CREATE TABLE "curated_listings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vertical" text NOT NULL CHECK ("vertical" IN ('BUS','TRAIN','STAY')),
	"status" text DEFAULT 'DRAFT' NOT NULL CHECK ("status" IN ('DRAFT','PUBLISHED','ARCHIVED')),
	"title" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"from_place" varchar(80),
	"to_place" varchar(80) NOT NULL,
	"operator" varchar(80),
	"price_quoted" boolean DEFAULT false NOT NULL,
	"price_minor" integer CHECK ("price_minor" IS NULL OR "price_minor" > 0),
	"currency" varchar(3),
	"valid_until" timestamp with time zone,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_by" uuid NOT NULL REFERENCES "users"("id"),
	"updated_by" uuid REFERENCES "users"("id"),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curated_listings_price_quoted" CHECK (("price_quoted" AND "price_minor" IS NOT NULL AND "currency" IS NOT NULL) OR (NOT "price_quoted" AND "price_minor" IS NULL AND "currency" IS NULL))
);--> statement-breakpoint
CREATE INDEX "curated_listings_public_idx" ON "curated_listings" ("vertical", "status", "sort_order");

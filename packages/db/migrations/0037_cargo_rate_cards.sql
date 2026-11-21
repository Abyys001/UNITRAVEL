-- ADR-0046 D4: postage rate cards per lane and service (set by staff with pricing.write).
CREATE TABLE "cargo_rate_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lane_id" uuid NOT NULL REFERENCES "cargo_lanes"("id"),
	"service" "cargo_service" NOT NULL,
	"currency" varchar(3) NOT NULL,
	"rate_per_kg_minor" integer NOT NULL,
	"minimum_charge_minor" integer DEFAULT 0 NOT NULL,
	"fuel_surcharge_pct" numeric(5, 2) DEFAULT 0 NOT NULL,
	"handling_fee_minor" integer DEFAULT 0 NOT NULL,
	"insurance_pct" numeric(5, 2) DEFAULT 0 NOT NULL,
	"notes" text,
	"updated_by" uuid NOT NULL REFERENCES "users"("id"),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "crc_lane_service_uq" ON "cargo_rate_cards" ("lane_id", "service");

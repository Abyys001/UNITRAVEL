-- ADR-0029: Google Flights through Apify as an indicative, metered flight source. Hand-written like 0003-0019; the journal entry is added by hand.
ALTER TABLE "providers" ADD COLUMN "metering" jsonb;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "invalid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "offer_snapshots" ADD COLUMN "revalidation_outcome" varchar(24);--> statement-breakpoint
CREATE TABLE "provider_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" varchar(40) NOT NULL REFERENCES "providers"("id"),
	"external_run_id" varchar(64),
	"pool" text NOT NULL CHECK ("pool" IN ('customer','prewarm','staff')),
	"purpose" text NOT NULL CHECK ("purpose" IN ('SEARCH','RECHECK','PREWARM')),
	"search_id" uuid,
	"routes" jsonb NOT NULL,
	"input" jsonb NOT NULL,
	"leg_keys" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL CHECK ("status" IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','TIMED-OUT','ABORTED','DECLINED')),
	"rows" integer DEFAULT 0 NOT NULL,
	"estimated_usd" numeric(10,4) DEFAULT 0 NOT NULL,
	"reserved_usd" numeric(10,4) DEFAULT 0 NOT NULL,
	"notices" jsonb DEFAULT '[]' NOT NULL,
	"errors" jsonb DEFAULT '[]' NOT NULL,
	"result" jsonb,
	"payload_key" varchar(300),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "provider_runs_provider_idx" ON "provider_runs" ("provider_id", "created_at");--> statement-breakpoint
-- Deployed databases are already seeded, so the provider row is inserted here too. Disabled, no shadow mode, no repricing (capabilities.price = false).
INSERT INTO "providers" ("id", "name", "environment", "enabled", "priority", "capabilities", "limits", "markets", "shadow_mode", "vertical", "metering")
VALUES ('apify-google-flights', 'Google Flights via Apify (indicative)', 'production', false, 9,
	'{"search":true,"price":false,"seatMap":false,"order":false}',
	'{"timeoutMs":20000,"maxConcurrent":2,"rps":1,"dailyBudget":2000,"lookToBookAlert":0}',
	'{"pointOfSale":"GB","currency":"GBP","originRegions":[],"destinationRegions":[]}', false, 'FLIGHT',
	'{"monthlyBudgetUsd":5,"poolSplit":{"customer":0.4,"prewarm":0.3,"staff":0.3},"staffReserveUsd":0.75,"customerRunsPerHour":6,"maxResultsCustomer":15,"maxResultsStaff":30,"cacheTtlSeconds":10800,"currency":"GBP","excludeAirlines":[],"maxLegsPerSearch":3,"watchlist":[]}')
ON CONFLICT DO NOTHING;

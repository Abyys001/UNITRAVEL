-- ADR-0034: scheduled flight catalog and dollar pacer. Hand-written like 0003-0021; the journal entry is added by hand.
ALTER TABLE "provider_runs" DROP CONSTRAINT IF EXISTS "provider_runs_pool_check";--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_pool_check" CHECK ("pool" IN ('customer','prewarm','staff','catalog'));--> statement-breakpoint
ALTER TABLE "provider_runs" DROP CONSTRAINT IF EXISTS "provider_runs_purpose_check";--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_purpose_check" CHECK ("purpose" IN ('SEARCH','RECHECK','PREWARM','CATALOG'));--> statement-breakpoint
CREATE TABLE "flight_watchlist_routes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"origin" varchar(3) NOT NULL,
	"destination" varchar(3) NOT NULL,
	"kind" text DEFAULT 'DIRECT' NOT NULL CHECK ("kind" IN ('DIRECT','COMBINED')),
	"via_hub" varchar(3),
	"enabled" boolean DEFAULT true NOT NULL,
	"horizon_days" integer DEFAULT 14 NOT NULL CHECK ("horizon_days" BETWEEN 1 AND 330),
	"max_results" integer CHECK ("max_results" IS NULL OR "max_results" BETWEEN 1 AND 100),
	"market" varchar(2),
	"currency" varchar(3),
	"priority_weight" real DEFAULT 1 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CHECK ("origin" <> "destination"),
	CHECK (("kind" = 'COMBINED') = ("via_hub" IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX "flight_watchlist_routes_pair_uq" ON "flight_watchlist_routes" ("origin","destination");--> statement-breakpoint
CREATE TABLE "catalog_slots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"route_id" uuid NOT NULL REFERENCES "flight_watchlist_routes"("id") ON DELETE cascade,
	"departure_date" date NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"next_due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'NEVER' NOT NULL CHECK ("status" IN ('NEVER','FRESH','AGING','STALE','EMPTY','ERROR')),
	"last_result_count" integer DEFAULT 0 NOT NULL,
	"recent_counts" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"consecutive_empty" integer DEFAULT 0 NOT NULL,
	"consecutive_errors" integer DEFAULT 0 NOT NULL,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"notices" jsonb DEFAULT '[]' NOT NULL,
	"demand_score" real DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_slots_route_date_uq" ON "catalog_slots" ("route_id","departure_date");--> statement-breakpoint
CREATE INDEX "catalog_slots_due_idx" ON "catalog_slots" ("next_due_at");--> statement-breakpoint
CREATE TABLE "flight_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slot_id" uuid REFERENCES "catalog_slots"("id") ON DELETE set null,
	"origin" varchar(3) NOT NULL,
	"destination" varchar(3) NOT NULL,
	"departure_date" date NOT NULL,
	"identity_key" varchar(300) NOT NULL,
	"self_transfer" boolean DEFAULT false NOT NULL,
	"compliance_review" boolean DEFAULT false NOT NULL,
	"offer" jsonb,
	"detail" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "flight_results_slot_identity_uq" ON "flight_results" ("slot_id","identity_key");--> statement-breakpoint
CREATE INDEX "flight_results_slot_current_idx" ON "flight_results" ("slot_id") WHERE "is_current";--> statement-breakpoint
CREATE INDEX "flight_results_route_date_current_idx" ON "flight_results" ("origin","destination","departure_date") WHERE "is_current";--> statement-breakpoint
CREATE TABLE "flight_result_legs" (
	"result_id" uuid NOT NULL REFERENCES "flight_results"("id") ON DELETE cascade,
	"position" integer NOT NULL,
	"leg_result_id" uuid NOT NULL REFERENCES "flight_results"("id") ON DELETE cascade,
	PRIMARY KEY ("result_id","position")
);--> statement-breakpoint
CREATE INDEX "flight_result_legs_leg_idx" ON "flight_result_legs" ("leg_result_id");--> statement-breakpoint
CREATE TABLE "flight_result_pricing" (
	"result_id" uuid PRIMARY KEY NOT NULL REFERENCES "flight_results"("id") ON DELETE cascade,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"previous_amount_minor" bigint,
	"price_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "catalog_public_snapshots" (
	"slot_id" uuid PRIMARY KEY NOT NULL REFERENCES "catalog_slots"("id") ON DELETE cascade,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "provider_usage_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(40) NOT NULL,
	"purpose" text NOT NULL CHECK ("purpose" IN ('refresh','admin_revalidate','admin_search','smoke')),
	"provider_run_id" uuid REFERENCES "provider_runs"("id") ON DELETE set null,
	"apify_run_id" varchar(64),
	"slot_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"max_results" integer NOT NULL,
	"rows_billed" integer DEFAULT 0 NOT NULL,
	"est_cost_usd" numeric(10,4) DEFAULT 0 NOT NULL,
	"max_charge_usd" numeric(10,4) DEFAULT 0 NOT NULL,
	"actual_cost_usd" numeric(10,4),
	"status" text DEFAULT 'RUNNING' NOT NULL CHECK ("status" IN ('RUNNING','SUCCEEDED','PARTIAL','FAILED','TIMED-OUT','ABORTED')),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "provider_usage_ledger_started_idx" ON "provider_usage_ledger" ("provider","started_at");--> statement-breakpoint
-- Owner's watchlist (brief, 2026-11-04). IKA→LHR is COMBINED: built at write time from the two feeders, never sent to Apify.
INSERT INTO "flight_watchlist_routes" ("id","origin","destination","kind","via_hub","horizon_days","max_results","note") VALUES
	('01970000-0000-7000-8000-00000000ca01','IKA','IST','DIRECT',NULL,14,3,'Owner seed. Often empty; Iran lane is REVIEW (ADR-0031).'),
	('01970000-0000-7000-8000-00000000ca02','IST','LHR','DIRECT',NULL,14,5,'Owner seed.'),
	('01970000-0000-7000-8000-00000000ca03','IKA','LHR','COMBINED','IST',14,NULL,'Self-transfer via IST, separate tickets.')
ON CONFLICT ("origin","destination") DO NOTHING;

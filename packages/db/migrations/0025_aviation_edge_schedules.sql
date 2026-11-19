-- ADR-0036: Aviation Edge as a schedule-only source beside the priced catalog. Hand-written like 0003-0024; the journal entry is added by hand.
CREATE TABLE "catalog_schedule_slots" (
	"slot_id" uuid PRIMARY KEY NOT NULL REFERENCES "catalog_slots"("id") ON DELETE cascade,
	"provider" varchar(40) NOT NULL,
	"status" text DEFAULT 'NEVER' NOT NULL CHECK ("status" IN ('NEVER','FRESH','EMPTY','ERROR')),
	"last_fetched_at" timestamp with time zone,
	"next_due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_result_count" integer DEFAULT 0 NOT NULL,
	"consecutive_errors" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"notices" jsonb DEFAULT '[]' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "catalog_schedule_slots_due_idx" ON "catalog_schedule_slots" ("next_due_at");--> statement-breakpoint
CREATE TABLE "flight_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slot_id" uuid REFERENCES "catalog_slots"("id") ON DELETE set null,
	"provider" varchar(40) NOT NULL,
	"origin" varchar(3) NOT NULL,
	"destination" varchar(3) NOT NULL,
	"departure_date" date NOT NULL,
	"identity_key" varchar(300) NOT NULL,
	"self_transfer" boolean DEFAULT false NOT NULL,
	"compliance_review" boolean DEFAULT false NOT NULL,
	"detail" jsonb NOT NULL,
	"provider_data" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "flight_schedules_slot_identity_uq" ON "flight_schedules" ("slot_id","identity_key");--> statement-breakpoint
CREATE INDEX "flight_schedules_slot_current_idx" ON "flight_schedules" ("slot_id") WHERE "is_current";--> statement-breakpoint
-- Deployed databases are already seeded, so the provider rows are inserted here too. Both disabled; capabilities all false so neither
-- ever becomes a searchable offer adapter. FlightAPI's row only lets its key be entered in the Developer Panel (ADR-0035 "not decided here").
INSERT INTO "providers" ("id", "name", "environment", "enabled", "priority", "capabilities", "limits", "markets", "shadow_mode", "vertical")
VALUES ('aviation-edge', 'Aviation Edge (future schedules, no prices)', 'production', false, 10,
	'{"search":false,"price":false,"seatMap":false,"order":false}',
	'{"timeoutMs":20000,"maxConcurrent":2,"rps":2,"dailyBudget":5000,"lookToBookAlert":0}',
	'{"pointOfSale":"GB","currency":"GBP","originRegions":[],"destinationRegions":[]}', false, 'FLIGHT'),
	('flightapi', 'FlightAPI.io (catalog source, indicative)', 'production', false, 11,
	'{"search":false,"price":false,"seatMap":false,"order":false}',
	'{"timeoutMs":90000,"maxConcurrent":2,"rps":1,"dailyBudget":2000,"lookToBookAlert":0}',
	'{"pointOfSale":"GB","currency":"GBP","originRegions":[],"destinationRegions":[]}', false, 'FLIGHT')
ON CONFLICT DO NOTHING;

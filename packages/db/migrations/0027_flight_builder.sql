-- ADR-0037: Flight Builder as a staff-capture source. Hand-written like 0003-0026; the journal entry is added by hand. Additive only.
ALTER TABLE "flight_results" ADD COLUMN "capture" text DEFAULT 'FEED' NOT NULL CHECK ("capture" IN ('FEED','STAFF'));--> statement-breakpoint
ALTER TABLE "flight_results" ADD COLUMN "captured_by" uuid REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "flight_results" ADD COLUMN "source_record_id" text;--> statement-breakpoint
ALTER TABLE "flight_results" ADD COLUMN "verification" text CHECK ("verification" IN ('RECORDED','VERIFIED'));--> statement-breakpoint
-- Staff-only context of a capture (the link to a request and the internal note); never part of a customer view.
ALTER TABLE "flight_results" ADD COLUMN "request_ref" varchar(12);--> statement-breakpoint
ALTER TABLE "flight_results" ADD COLUMN "capture_note" text;--> statement-breakpoint
CREATE INDEX "flight_results_staff_current_idx" ON "flight_results" ("slot_id") WHERE "capture" = 'STAFF' AND "is_current";--> statement-breakpoint
CREATE TABLE "flight_result_fares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"result_id" uuid NOT NULL REFERENCES "flight_results"("id") ON DELETE cascade,
	"position" integer NOT NULL,
	"cabin" text NOT NULL,
	"booking_classes" text[] NOT NULL,
	"seats_raw" text[] NOT NULL,
	"fare_basis" text[] DEFAULT '{}' NOT NULL,
	"fare_type" varchar(8) NOT NULL CHECK ("fare_type" IN ('PUB','NEGO','TOP','VFR','OTHER')),
	"fare_type_raw" text,
	"base_minor" bigint,
	"taxes_minor" bigint,
	"total_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"baggage" jsonb NOT NULL,
	"conditions" jsonb NOT NULL,
	"ticketing_deadline" date,
	"status" text DEFAULT 'LIVE' NOT NULL CHECK ("status" IN ('LIVE','STALE','EXPIRED','RETIRED')),
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "flight_result_fares_result_position_uq" ON "flight_result_fares" ("result_id","position");--> statement-breakpoint
CREATE INDEX "flight_result_fares_deadline_live_idx" ON "flight_result_fares" ("ticketing_deadline") WHERE "status" = 'LIVE';--> statement-breakpoint
CREATE INDEX "flight_result_fares_live_idx" ON "flight_result_fares" ("result_id") WHERE "status" = 'LIVE';--> statement-breakpoint
-- The snapshot of a CATALOG request: the staff copy (with price) and exactly what the customer saw. Append-only triggers of 0001/0026 cover these columns.
ALTER TABLE "offer_snapshots" ADD COLUMN "catalog_result_id" uuid;--> statement-breakpoint
ALTER TABLE "offer_snapshots" ADD COLUMN "fare" jsonb;--> statement-breakpoint
ALTER TABLE "offer_snapshots" ADD COLUMN "customer_view" jsonb;--> statement-breakpoint
CREATE TABLE "provider_authorisations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" varchar(40) NOT NULL REFERENCES "providers"("id"),
	"document_ref" text NOT NULL,
	"granted_by_name" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"scope" text NOT NULL,
	"max_searches_per_day" integer,
	"expires_at" timestamp with time zone,
	"recorded_by" uuid NOT NULL REFERENCES "users"("id"),
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid REFERENCES "users"("id"),
	"revoked_reason" text
);--> statement-breakpoint
CREATE INDEX "provider_authorisations_provider_idx" ON "provider_authorisations" ("provider_id","recorded_at");--> statement-breakpoint
-- Revocation is the only allowed change, once; nothing else is editable and nothing is deleted.
CREATE OR REPLACE FUNCTION provider_authorisations_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'provider_authorisations row % is already revoked', OLD.id;
  END IF;
  IF NEW.revoked_at IS NULL OR NEW.revoked_by IS NULL OR NEW.revoked_reason IS NULL
     OR NEW.id <> OLD.id OR NEW.provider_id <> OLD.provider_id OR NEW.document_ref <> OLD.document_ref OR NEW.granted_by_name <> OLD.granted_by_name
     OR NEW.granted_at <> OLD.granted_at OR NEW.scope <> OLD.scope OR NEW.max_searches_per_day IS DISTINCT FROM OLD.max_searches_per_day
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.recorded_by <> OLD.recorded_by OR NEW.recorded_at <> OLD.recorded_at THEN
    RAISE EXCEPTION 'provider_authorisations only allows setting the revoked_* columns';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER provider_authorisations_guard BEFORE UPDATE ON provider_authorisations FOR EACH ROW EXECUTE FUNCTION provider_authorisations_guard();--> statement-breakpoint
CREATE TRIGGER provider_authorisations_no_delete BEFORE DELETE ON provider_authorisations FOR EACH ROW EXECUTE FUNCTION forbid_mutation();--> statement-breakpoint
CREATE TRIGGER provider_authorisations_no_truncate BEFORE TRUNCATE ON provider_authorisations FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();--> statement-breakpoint
CREATE TABLE "flight_builder_usage_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"bookings" integer NOT NULL,
	"scan_hits" integer NOT NULL,
	"warning_threshold" integer DEFAULT 45 NOT NULL,
	"critical_threshold" integer DEFAULT 50 NOT NULL,
	"remaining_reported" integer,
	"source" text NOT NULL CHECK ("source" IN ('MANUAL','REPORTED','ESTIMATED')),
	"observer_user_id" uuid NOT NULL REFERENCES "users"("id"),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "fb_usage_observed_idx" ON "flight_builder_usage_observations" ("observed_at");--> statement-breakpoint
CREATE TRIGGER fb_usage_append_only BEFORE UPDATE ON flight_builder_usage_observations FOR EACH ROW EXECUTE FUNCTION forbid_mutation();--> statement-breakpoint
CREATE TRIGGER fb_usage_no_delete BEFORE DELETE ON flight_builder_usage_observations FOR EACH ROW EXECUTE FUNCTION forbid_mutation();--> statement-breakpoint
CREATE TRIGGER fb_usage_no_truncate BEFORE TRUNCATE ON flight_builder_usage_observations FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();--> statement-breakpoint
CREATE TABLE "flight_builder_sync_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL CHECK ("trigger" IN ('MANUAL','SCHEDULED')),
	"scope" jsonb DEFAULT '{}' NOT NULL,
	"status" text NOT NULL CHECK ("status" IN ('BLOCKED','RUNNING','SUCCEEDED','PARTIAL','FAILED')),
	"blocked_reason" text,
	"imported" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"error_detail" jsonb,
	"actor_user_id" uuid REFERENCES "users"("id"),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX "fb_sync_runs_started_idx" ON "flight_builder_sync_runs" ("started_at");--> statement-breakpoint
-- Deployed databases are already seeded, so the provider row is inserted here too. Disabled, all capabilities false: it is never an offer adapter.
INSERT INTO "providers" ("id", "name", "environment", "enabled", "priority", "capabilities", "limits", "markets", "shadow_mode", "vertical")
VALUES ('flight-builder', 'Flight Builder (staff capture, no automated access)', 'production', false, 12,
	'{"search":false,"price":false,"seatMap":false,"order":false}',
	'{"timeoutMs":20000,"maxConcurrent":1,"rps":1,"dailyBudget":0,"lookToBookAlert":0}',
	'{"pointOfSale":"GB","currency":"GBP","originRegions":[],"destinationRegions":[]}', false, 'FLIGHT')
ON CONFLICT DO NOTHING;

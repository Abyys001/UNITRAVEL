-- Staff amendments of a flight request's trip and travellers (ADR-0013 A1-A4). Insert-only: what was asked before and after
-- each change, who changed it and why. migrate.ts grants app_rw SELECT and INSERT only.
CREATE TABLE "request_amendments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_type" text NOT NULL CHECK ("request_type" IN ('FLIGHT')),
	"request_id" uuid NOT NULL REFERENCES "flight_requests"("id"),
	"version_before" integer NOT NULL,
	"actor_user_id" uuid NOT NULL REFERENCES "users"("id"),
	"reason" text NOT NULL CHECK (length("reason") >= 5),
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "request_amendments_request_idx" ON "request_amendments" ("request_id", "created_at");--> statement-breakpoint
CREATE TRIGGER request_amendments_append_only BEFORE UPDATE OR DELETE ON request_amendments FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

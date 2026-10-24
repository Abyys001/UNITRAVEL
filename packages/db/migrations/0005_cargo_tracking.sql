-- Phase E: cargo tracking. Hand-written like 0003 and 0004; the journal entry is added by hand.
-- No new permission: corrections and the estimate use cargo_request.transition (cargo_admin, admin, owner).
ALTER TABLE "cargo_requests" ADD COLUMN "estimated_delivery_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD COLUMN "external_event_id" varchar(120);--> statement-breakpoint
ALTER TABLE "tracking_events" ADD COLUMN "corrects_event_id" uuid REFERENCES "tracking_events"("id");--> statement-breakpoint
ALTER TABLE "tracking_events" ADD COLUMN "correction_reason" text;--> statement-breakpoint
-- Replayed partner events are no-ops; staff entries have no external id (NULLs are distinct).
CREATE UNIQUE INDEX "tracking_source_external_uq" ON "tracking_events" ("source", "external_event_id");--> statement-breakpoint
CREATE INDEX "tracking_corrects_idx" ON "tracking_events" ("corrects_event_id");--> statement-breakpoint
-- Corrections are appended, never edited in place: the trigger also stops the table owner; migrate.ts removes UPDATE/DELETE from app_rw.
CREATE TRIGGER tracking_events_append_only BEFORE UPDATE OR DELETE ON tracking_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

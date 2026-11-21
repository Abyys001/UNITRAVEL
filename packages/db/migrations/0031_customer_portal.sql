-- ADR-0040: customer portal. Hand-written like 0003-0028; the journal entry is added by hand. Additive only.
-- D3: when the customer last opened the ticket. A staff reply newer than this is "unread" for the customer.
ALTER TABLE "support_tickets" ADD COLUMN "customer_read_at" timestamp with time zone;--> statement-breakpoint
-- D5: per-shipment state of carrier tracking through TrackingMore. No row = not registered (NOT_CONFIGURED or never asked).
CREATE TABLE "cargo_carrier_tracking" (
	"cargo_request_id" uuid PRIMARY KEY NOT NULL REFERENCES "cargo_requests"("id"),
	"provider" varchar(20) DEFAULT 'TRACKINGMORE' NOT NULL CHECK ("provider" IN ('TRACKINGMORE')),
	"awb_number" varchar(12) NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL CHECK ("state" IN ('PENDING','ACTIVE','UNAVAILABLE')),
	"airline" varchar(120),
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "cargo_carrier_tracking_state_idx" ON "cargo_carrier_tracking" ("state", "last_synced_at");--> statement-breakpoint
-- Existing tickets count as read so a deploy does not light up every old reply.
UPDATE "support_tickets" SET "customer_read_at" = now() WHERE "user_id" IS NOT NULL;

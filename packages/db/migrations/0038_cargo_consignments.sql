-- ADR-0047: manual-courier consignments, customer rates, customs reviews, rate-card markup.
ALTER TABLE "cargo_rate_cards" ADD COLUMN "markup_pct" numeric(6, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cargo_rate_cards" ADD COLUMN "margin_fixed_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE SEQUENCE "cargo_consignment_seq" START 1;--> statement-breakpoint
CREATE TABLE "cargo_consignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shipment_no" varchar(12) DEFAULT ('SH-' || lpad(nextval('cargo_consignment_seq')::text, 6, '0')) NOT NULL UNIQUE,
	"cargo_request_id" uuid NOT NULL REFERENCES "cargo_requests"("id"),
	"direction" text DEFAULT 'OUTBOUND' NOT NULL,
	"partner_id" uuid NOT NULL REFERENCES "partners"("id"),
	"service_level" varchar(20) NOT NULL,
	"tracked" boolean DEFAULT true NOT NULL,
	"signed_for" boolean DEFAULT false NOT NULL,
	"courier_tracking_number" varchar(60),
	"courier_tracking_url" varchar(500),
	"ship_date" date,
	"estimated_delivery" date,
	"cost_minor" integer,
	"cost_currency" varchar(3),
	"label_document_id" uuid,
	"status" text DEFAULT 'BOOKED' NOT NULL,
	"cancel_reason" text,
	"note" text,
	"dispatched_at" timestamp with time zone,
	"created_by" uuid NOT NULL REFERENCES "users"("id"),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "ccons_request_idx" ON "cargo_consignments" ("cargo_request_id");--> statement-breakpoint
CREATE INDEX "ccons_status_idx" ON "cargo_consignments" ("status", "ship_date");--> statement-breakpoint
CREATE TABLE "cargo_customer_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_user_id" uuid NOT NULL REFERENCES "users"("id"),
	"lane_id" uuid REFERENCES "cargo_lanes"("id"),
	"service" "cargo_service",
	"discount_pct" numeric(5, 2) DEFAULT 0 NOT NULL,
	"markup_pct" numeric(6, 2),
	"note" text,
	"updated_by" uuid NOT NULL REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "ccr_customer_idx" ON "cargo_customer_rates" ("customer_user_id");--> statement-breakpoint
CREATE TABLE "cargo_customs_reviews" (
	"cargo_request_id" uuid PRIMARY KEY NOT NULL REFERENCES "cargo_requests"("id"),
	"export_reason" varchar(30) NOT NULL,
	"incoterm" text DEFAULT 'DAP' NOT NULL,
	"duties_payer" text DEFAULT 'RECEIVER' NOT NULL,
	"invoice_number" varchar(40),
	"notes" text,
	"items_hash" varchar(64),
	"approved_by" uuid REFERENCES "users"("id"),
	"approved_at" timestamp with time zone,
	"updated_by" uuid NOT NULL REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

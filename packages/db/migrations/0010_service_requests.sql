-- ADR-0015: service requests (visa, tours, CIP, insurance, later hotel/stay/train/bus). Hand-written like 0003-0007; the journal entry is added by hand.
-- Status history, messages, notes, quotes, documents, invoices, payments and compliance cases reuse the shared request
-- tables through the new request_type value SERVICE, so a service request is screened, quoted and invoiced like the others.
-- The new value is not used inside this migration (an enum value added in a transaction cannot be used until it commits).
ALTER TYPE "request_type" ADD VALUE IF NOT EXISTS 'SERVICE';--> statement-breakpoint
CREATE TYPE "service_request_type" AS ENUM('VISA', 'TOUR_CALLBACK', 'CIP', 'INSURANCE', 'HOTEL', 'STAY', 'TRAIN', 'BUS');--> statement-breakpoint
CREATE TYPE "service_request_status" AS ENUM('SUBMITTED', 'COMPLIANCE_HOLD', 'IN_PROGRESS', 'QUOTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'CLOSED_NO_RESPONSE', 'DECLINED');--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" varchar(12) NOT NULL UNIQUE,
	"type" "service_request_type" NOT NULL,
	"status" "service_request_status" DEFAULT 'SUBMITTED' NOT NULL,
	"customer_user_id" uuid NOT NULL REFERENCES "users"("id"),
	"contact_identity_id" uuid NOT NULL REFERENCES "user_identities"("id"),
	"contact_phone_snapshot" varchar(16) NOT NULL,
	"details" jsonb NOT NULL,
	"submitted_via" text DEFAULT 'WEB' NOT NULL CHECK ("submitted_via" IN ('WEB','MOBILE','CONSOLE')),
	"submitted_locale" text DEFAULT 'en' NOT NULL CHECK ("submitted_locale" IN ('en','fa')),
	"assignee_user_id" uuid REFERENCES "users"("id"),
	"sla_due_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "sr_queue_idx" ON "service_requests" ("status", "sla_due_at");--> statement-breakpoint
CREATE INDEX "sr_customer_idx" ON "service_requests" ("customer_user_id", "submitted_at");--> statement-breakpoint
CREATE INDEX "sr_assignee_idx" ON "service_requests" ("assignee_user_id", "status");--> statement-breakpoint
CREATE INDEX "sr_type_idx" ON "service_requests" ("type", "status");--> statement-breakpoint
-- Service quotes keep their lines and note on the shared quotes table (cargo does the same with cargo_lines).
ALTER TABLE "quotes" ADD COLUMN "service_lines" jsonb;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "service_note" text;--> statement-breakpoint
-- Which product a provider serves; existing rows are flight providers. No stay, rail or bus provider exists yet (ADR-0015).
ALTER TABLE "providers" ADD COLUMN "vertical" text DEFAULT 'FLIGHT' NOT NULL CHECK ("vertical" IN ('FLIGHT','STAY','RAIL','BUS'));--> statement-breakpoint
-- Permissions for roles that already exist (new installs get them from the seed). The loyalty.* grants are included so
-- the catalogue and the database agree; the club tables arrive in migration 0010 (ADR-0016).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p.permission FROM "roles" r
JOIN (VALUES
	('customer', 'service_request.create.own'), ('customer', 'service_request.read.own'), ('customer', 'loyalty.read.own'),
	('admin', 'service_request.read.any'), ('admin', 'service_request.write'), ('admin', 'loyalty.read'), ('admin', 'loyalty.manage'), ('admin', 'loyalty.benefit.approve'),
	('compliance_officer', 'service_request.read.any'),
	('owner', 'service_request.create.own'), ('owner', 'service_request.read.own'), ('owner', 'service_request.read.any'), ('owner', 'service_request.write'),
	('owner', 'loyalty.read.own'), ('owner', 'loyalty.read'), ('owner', 'loyalty.manage'), ('owner', 'loyalty.benefit.approve')
) AS p(role_key, permission) ON p.role_key = r."key"
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Sessions carry permissions in the token; bump the version so holders refresh them.
UPDATE "users" SET "perm_version" = "perm_version" + 1
WHERE "id" IN (SELECT ur."user_id" FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE r."key" IN ('customer', 'admin', 'compliance_officer', 'owner'));

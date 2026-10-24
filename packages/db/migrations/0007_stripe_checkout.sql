-- ADR-0007: Stripe Embedded Checkout, test mode only (Phase D). Hand-written like 0003-0006; the journal entry is added by hand.
ALTER TABLE "payment_records" ALTER COLUMN "recorded_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "provider" text CHECK ("provider" IN ('STRIPE','FAKE'));--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "provider_ref" varchar(255);--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "refunded_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
-- A replayed or reconciled event cannot record the same PaymentIntent twice.
CREATE UNIQUE INDEX "payment_records_provider_ref_uq" ON "payment_records" ("provider_ref") WHERE "provider_ref" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "payment_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL REFERENCES "invoices"("id"),
	"provider" text NOT NULL CHECK ("provider" IN ('STRIPE','FAKE')),
	"mode" text DEFAULT 'test' NOT NULL CHECK ("mode" IN ('test','live')),
	"provider_session_id" varchar(255) NOT NULL UNIQUE,
	"status" text DEFAULT 'OPEN' NOT NULL CHECK ("status" IN ('OPEN','COMPLETE','EXPIRED','FAILED','MISMATCH')),
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"attempt" integer NOT NULL,
	"payment_intent_id" varchar(255),
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "payment_sessions_invoice_idx" ON "payment_sessions" ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_sessions_one_open_per_invoice_uq" ON "payment_sessions" ("invoice_id") WHERE "status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "payment_sessions_status_idx" ON "payment_sessions" ("status", "created_at");--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"type" varchar(120) NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL CHECK ("mode" IN ('test','live')),
	"outcome" text NOT NULL CHECK ("outcome" IN ('PROCESSED','IGNORED','FAILED','MISMATCH')),
	"error" text,
	"object_id" varchar(255),
	"summary" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX "stripe_events_received_idx" ON "stripe_events" ("received_at");--> statement-breakpoint
CREATE INDEX "stripe_events_outcome_idx" ON "stripe_events" ("outcome");--> statement-breakpoint
CREATE TABLE "refund_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL REFERENCES "invoices"("id"),
	"payment_record_id" uuid NOT NULL REFERENCES "payment_records"("id"),
	"amount_minor" bigint NOT NULL CHECK ("amount_minor" > 0),
	"currency" varchar(3) NOT NULL,
	"reason_code" text NOT NULL CHECK ("reason_code" IN ('CUSTOMER_REQUEST','DUPLICATE','AMOUNT_MISMATCH','SERVICE_NOT_DELIVERED','OTHER')),
	"note" text,
	"status" text DEFAULT 'PENDING_APPROVAL' NOT NULL CHECK ("status" IN ('PENDING_APPROVAL','SUBMITTED','COMPLETED','REJECTED','FAILED')),
	"requested_by" uuid NOT NULL REFERENCES "users"("id"),
	"approved_by" uuid REFERENCES "users"("id"),
	"decided_at" timestamp with time zone,
	"provider_refund_id" varchar(255),
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "refund_requests_invoice_idx" ON "refund_requests" ("invoice_id");--> statement-breakpoint
CREATE INDEX "refund_requests_status_idx" ON "refund_requests" ("status");--> statement-breakpoint
CREATE TABLE "payment_config" (
	"key" varchar(20) PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'STRIPE' NOT NULL CHECK ("provider" IN ('STRIPE','FAKE')),
	"mode" text DEFAULT 'test' NOT NULL CHECK ("mode" IN ('test','live')),
	"pending_mode" text CHECK ("pending_mode" IN ('test','live')),
	"pending_by" uuid,
	"pending_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- Live is BLOCKED in code (ADR-0007 P1); the database refuses it too, as a second lock.
ALTER TABLE "payment_config" ADD CONSTRAINT "payment_config_live_blocked" CHECK ("mode" = 'test');--> statement-breakpoint
ALTER TABLE "payment_sessions" ADD CONSTRAINT "payment_sessions_live_blocked" CHECK ("mode" = 'test');--> statement-breakpoint
INSERT INTO "payment_config" ("key") VALUES ('stripe') ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Eligibility policy (ADR-0007 P11): ALLOW for both products and GBP, seeded pending counsel like the other seed policies.
INSERT INTO "compliance_policies" ("id", "type", "key", "action", "reason", "status", "created_by", "approved_by", "approved_at", "seeded_pending_counsel")
SELECT gen_random_uuid(), 'ONLINE_PAYMENT', p.key, 'ALLOW', 'ADR-0007 seed: online card payment may be offered for this ' || p.what || '. Seed, pending counsel review; the feature flag payments.online.enabled is off.', 'ACTIVE', '00000000-0000-7000-8000-000000000000', '00000000-0000-7000-8000-000000000000', now(), true
FROM (VALUES ('product:FLIGHT', 'product'), ('product:CARGO', 'product'), ('currency:GBP', 'currency')) AS p(key, what)
WHERE NOT EXISTS (SELECT 1 FROM "compliance_policies" c WHERE c."type" = 'ONLINE_PAYMENT' AND c."key" = p.key);--> statement-breakpoint
-- Permissions for roles that already exist (new installs get them from the seed).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", g.permission FROM "roles" r
JOIN (VALUES
  ('admin', 'payment.refund.request'), ('admin', 'payment.refund.approve'),
  ('owner', 'payment.refund.request'), ('owner', 'payment.refund.approve'), ('owner', 'payments.configure'), ('owner', 'payments.mode.approve'),
  ('developer', 'payments.configure')
) AS g(role_key, permission) ON r."key" = g.role_key
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Sessions carry permissions in the token; bump the version so holders refresh them (after deploy also clear Valkey perm:* keys).
UPDATE "users" SET "perm_version" = "perm_version" + 1
WHERE "id" IN (SELECT ur."user_id" FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE r."key" IN ('admin', 'owner', 'developer'));
--> statement-breakpoint
UPDATE "feature_flags" SET "description" = 'Online card payment, Stripe test mode only (ADR-0007, amends D-03); off by default, switched on by an owner' WHERE "key" = 'payments.online.enabled';

-- ADR-0016: customer club. Hand-written like 0003-0010; the journal entry is added by hand.
-- Benefits reach money only as a staff-built quote line; the ledger is insert-only like the audit log.
-- Permissions were granted to existing roles in 0010, so this migration only creates tables.
CREATE TABLE "loyalty_tiers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(24) NOT NULL UNIQUE,
	"name_en" varchar(60) NOT NULL,
	"name_fa" varchar(60) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "loyalty_members" (
	"user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id"),
	"tier_id" uuid NOT NULL REFERENCES "loyalty_tiers"("id"),
	"status" text DEFAULT 'ACTIVE' NOT NULL CHECK ("status" IN ('ACTIVE','SUSPENDED','REMOVED')),
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" uuid NOT NULL REFERENCES "users"("id"),
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "loyalty_members_tier_idx" ON "loyalty_members" ("tier_id", "status");--> statement-breakpoint
CREATE TABLE "loyalty_benefits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL CHECK ("kind" IN ('DISCOUNT_PERCENT','DISCOUNT_FIXED','BONUS_CREDIT','PERK')),
	"value" integer NOT NULL CHECK ("value" >= 0),
	"currency" varchar(3),
	"applies_to" text NOT NULL CHECK ("applies_to" IN ('FLIGHT','CARGO','SERVICE','ANY')),
	"tier_id" uuid REFERENCES "loyalty_tiers"("id"),
	"user_id" uuid REFERENCES "users"("id"),
	"description" jsonb NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"status" text NOT NULL CHECK ("status" IN ('PENDING_APPROVAL','ACTIVE','EXPIRED','REVOKED')),
	"created_by" uuid NOT NULL REFERENCES "users"("id"),
	"approved_by" uuid REFERENCES "users"("id"),
	"approved_at" timestamp with time zone,
	"revoked_by" uuid REFERENCES "users"("id"),
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- One tier or one member, never both or neither; the window is not empty; an approver is never the author.
	CONSTRAINT "loyalty_benefits_one_target" CHECK (("tier_id" IS NULL) <> ("user_id" IS NULL)),
	CONSTRAINT "loyalty_benefits_window" CHECK ("valid_to" > "valid_from"),
	CONSTRAINT "loyalty_benefits_four_eyes" CHECK ("approved_by" IS NULL OR "approved_by" <> "created_by")
);--> statement-breakpoint
CREATE INDEX "loyalty_benefits_user_idx" ON "loyalty_benefits" ("user_id", "status");--> statement-breakpoint
CREATE INDEX "loyalty_benefits_tier_idx" ON "loyalty_benefits" ("tier_id", "status");--> statement-breakpoint
CREATE TABLE "loyalty_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"kind" text NOT NULL CHECK ("kind" IN ('GRANTED','USED','EXPIRED','REVERSED')),
	"amount_minor" integer NOT NULL CHECK ("amount_minor" > 0),
	"currency" varchar(3) NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" uuid NOT NULL REFERENCES "users"("id"),
	"benefit_id" uuid REFERENCES "loyalty_benefits"("id"),
	"invoice_id" uuid REFERENCES "invoices"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "loyalty_ledger_user_idx" ON "loyalty_ledger" ("user_id", "created_at");--> statement-breakpoint
CREATE TRIGGER loyalty_ledger_append_only BEFORE UPDATE OR DELETE ON loyalty_ledger FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

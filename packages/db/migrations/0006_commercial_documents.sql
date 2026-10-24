-- ADR-0006: quotations and invoices (Phase C). Hand-written like 0003-0005; the journal entry is added by hand.
-- No new permission: commercial_document.issue, pricing.read.internal and pricing.write exist since 0003.
ALTER TABLE "quotes" ADD COLUMN "document_number" varchar(32);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "pdf_document_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_document_number_unique" UNIQUE ("document_number");--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"kind" text NOT NULL CHECK ("kind" IN ('QUOTATION','INVOICE')),
	"year" integer NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	PRIMARY KEY ("kind", "year")
);--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" varchar(32) UNIQUE,
	"request_type" "request_type" NOT NULL,
	"request_id" uuid NOT NULL,
	"request_ref" varchar(12) NOT NULL,
	"customer_user_id" uuid NOT NULL REFERENCES "users"("id"),
	"quote_id" uuid NOT NULL REFERENCES "quotes"("id"),
	"status" text DEFAULT 'DRAFT' NOT NULL CHECK ("status" IN ('DRAFT','ISSUED','PAID','CANCELLED','REFUNDED')),
	"currency" varchar(3) NOT NULL,
	"total_minor" bigint NOT NULL CHECK ("total_minor" > 0),
	"issued_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text CHECK ("cancel_reason" IN ('EXPIRED','CORRECTION','CUSTOMER_REQUEST','DUPLICATE','OTHER')),
	"document_id" uuid,
	"created_by" uuid NOT NULL REFERENCES "users"("id"),
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_issued_has_number" CHECK ("status" = 'DRAFT' OR ("number" IS NOT NULL AND "issued_at" IS NOT NULL AND "expires_at" IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX "invoices_request_idx" ON "invoices" ("request_type", "request_id");--> statement-breakpoint
CREATE INDEX "invoices_customer_idx" ON "invoices" ("customer_user_id");--> statement-breakpoint
CREATE INDEX "invoices_status_expiry_idx" ON "invoices" ("status", "expires_at");--> statement-breakpoint
-- One live invoice per quote (a paid one counts: no double billing); a correction cancels first, then reissues.
CREATE UNIQUE INDEX "invoices_one_open_per_quote_uq" ON "invoices" ("quote_id") WHERE "status" in ('DRAFT', 'ISSUED', 'PAID');--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL REFERENCES "invoices"("id"),
	"position" integer NOT NULL,
	"description" varchar(200) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL CHECK ("quantity" > 0),
	"unit_amount_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" ("invoice_id", "position");--> statement-breakpoint
CREATE TABLE "invoice_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL REFERENCES "invoices"("id"),
	"from_status" text CHECK ("from_status" IN ('DRAFT','ISSUED','PAID','CANCELLED','REFUNDED')),
	"to_status" text NOT NULL CHECK ("to_status" IN ('DRAFT','ISSUED','PAID','CANCELLED','REFUNDED')),
	"command" varchar(30) NOT NULL,
	"reason_code" varchar(30),
	"reason_text" text,
	"actor_user_id" uuid REFERENCES "users"("id"),
	"actor_kind" text NOT NULL CHECK ("actor_kind" IN ('STAFF','SYSTEM')),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "invoice_history_invoice_idx" ON "invoice_status_history" ("invoice_id", "created_at");--> statement-breakpoint
-- History is insert-only: the trigger also stops the table owner; migrate.ts removes UPDATE/DELETE from app_rw.
CREATE TRIGGER invoice_status_history_append_only BEFORE UPDATE OR DELETE ON invoice_status_history FOR EACH ROW EXECUTE FUNCTION forbid_mutation();--> statement-breakpoint
-- Amounts are fixed at issue (ADR-0006 C4): total, currency and number cannot change once the invoice has left DRAFT.
CREATE FUNCTION invoices_freeze_amounts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD.status <> 'DRAFT' AND (NEW.total_minor <> OLD.total_minor OR NEW.currency <> OLD.currency OR NEW.number IS DISTINCT FROM OLD.number OR NEW.quote_id <> OLD.quote_id) THEN
		RAISE EXCEPTION 'invoice % amounts are fixed at issue; cancel and reissue', OLD.id USING ERRCODE = 'integrity_constraint_violation';
	END IF;
	IF TG_OP = 'UPDATE' AND NEW.number IS NOT NULL AND OLD.number IS NOT NULL AND NEW.number <> OLD.number THEN
		RAISE EXCEPTION 'invoice numbers never change' USING ERRCODE = 'integrity_constraint_violation';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER invoices_freeze_amounts BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_freeze_amounts();--> statement-breakpoint
CREATE FUNCTION invoice_lines_only_in_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent text;
BEGIN
	SELECT status INTO parent FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
	IF parent IS DISTINCT FROM 'DRAFT' THEN
		RAISE EXCEPTION 'invoice lines are fixed once the invoice is issued' USING ERRCODE = 'integrity_constraint_violation';
	END IF;
	RETURN COALESCE(NEW, OLD);
END $$;--> statement-breakpoint
CREATE TRIGGER invoice_lines_only_in_draft BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION invoice_lines_only_in_draft();

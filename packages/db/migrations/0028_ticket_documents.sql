-- ADR-0038: issued ticket documents (provider original, branded wrapper, code-integrity result). Hand-written like 0003-0027; the journal entry is added by hand. Additive only.
CREATE TABLE "ticket_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL REFERENCES "flight_requests"("id"),
	"reservation_id" uuid REFERENCES "reservations"("id"),
	"chain_id" uuid NOT NULL,
	"version" integer NOT NULL CHECK ("version" >= 1),
	"supersedes_id" uuid REFERENCES "ticket_documents"("id"),
	"kind" text NOT NULL CHECK ("kind" IN ('E_TICKET','BOARDING_PASS')),
	"status" text DEFAULT 'DRAFT' NOT NULL CHECK ("status" IN ('DRAFT','ISSUED','SUPERSEDED','REVOKED')),
	"original_document_id" uuid NOT NULL REFERENCES "documents"("id"),
	"original_sha256" varchar(64) NOT NULL CHECK ("original_sha256" ~ '^[0-9a-f]{64}$'),
	"branded_document_id" uuid REFERENCES "documents"("id"),
	"branded_sha256" varchar(64),
	"wrapper_mode" text NOT NULL CHECK ("wrapper_mode" IN ('FULL','COVER_ONLY')),
	"verification" jsonb NOT NULL,
	"cover" jsonb NOT NULL,
	"pending_records" jsonb,
	"notes" text,
	"reason" text,
	"passenger_email_enc" text,
	"text_warnings_acknowledged_by" uuid REFERENCES "users"("id"),
	"created_by" uuid NOT NULL REFERENCES "users"("id"),
	"issued_by" uuid REFERENCES "users"("id"),
	"issued_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"revoked_by" uuid REFERENCES "users"("id"),
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- An issued version always has its branded file; a revocation always has its reason.
	CONSTRAINT "ticket_documents_issued_chk" CHECK ("status" = 'DRAFT' OR "status" = 'REVOKED' OR ("branded_document_id" IS NOT NULL AND "issued_at" IS NOT NULL)),
	CONSTRAINT "ticket_documents_revoked_chk" CHECK ("status" <> 'REVOKED' OR ("revoked_reason" IS NOT NULL AND "revoked_at" IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX "ticket_documents_request_idx" ON "ticket_documents" ("request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_documents_chain_version_uq" ON "ticket_documents" ("chain_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_documents_chain_issued_uq" ON "ticket_documents" ("chain_id") WHERE "status" = 'ISSUED';--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_documents_supersedes_live_uq" ON "ticket_documents" ("supersedes_id") WHERE "supersedes_id" is not null and "status" in ('DRAFT','ISSUED');--> statement-breakpoint
CREATE INDEX "ticket_documents_status_idx" ON "ticket_documents" ("status","created_at");--> statement-breakpoint
-- D2: the file references and the integrity record of a version never change; only the status and its stamps move, and a final status is final.
CREATE OR REPLACE FUNCTION ticket_documents_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.original_document_id <> OLD.original_document_id OR NEW.original_sha256 <> OLD.original_sha256 OR NEW.chain_id <> OLD.chain_id OR NEW.version <> OLD.version
     OR NEW.request_id <> OLD.request_id OR NEW.verification IS DISTINCT FROM OLD.verification OR NEW.cover IS DISTINCT FROM OLD.cover
     OR (OLD.branded_document_id IS NOT NULL AND NEW.branded_document_id IS DISTINCT FROM OLD.branded_document_id) THEN
    RAISE EXCEPTION 'ticket_documents row % is immutable apart from its status', OLD.id;
  END IF;
  IF OLD.status IN ('SUPERSEDED','REVOKED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'ticket_documents row % is final (%)', OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "ticket_documents_guard" BEFORE UPDATE ON "ticket_documents" FOR EACH ROW EXECUTE FUNCTION ticket_documents_guard();--> statement-breakpoint
CREATE OR REPLACE FUNCTION ticket_documents_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ticket_documents rows are never deleted';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "ticket_documents_no_delete" BEFORE DELETE ON "ticket_documents" FOR EACH ROW EXECUTE FUNCTION ticket_documents_no_delete();--> statement-breakpoint
CREATE TABLE "ticket_document_travellers" (
	"ticket_document_id" uuid NOT NULL REFERENCES "ticket_documents"("id"),
	"traveller_id" uuid NOT NULL REFERENCES "travellers"("id"),
	"ticket_id" uuid REFERENCES "tickets"("id"),
	"name" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_document_travellers_pk" PRIMARY KEY ("ticket_document_id","traveller_id")
);--> statement-breakpoint
CREATE INDEX "ticket_document_travellers_traveller_idx" ON "ticket_document_travellers" ("traveller_id");--> statement-breakpoint
-- D6: each send of a version is a delivery row linked to it; a passenger address is a second EMAIL delivery of the same notification.
ALTER TABLE "notification_deliveries" ADD COLUMN "ticket_document_id" uuid REFERENCES "ticket_documents"("id");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "recipient" text DEFAULT 'ACCOUNT' NOT NULL CHECK ("recipient" IN ('ACCOUNT','PASSENGER'));--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "address_enc" text;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_notification_channel_recipient_uq" ON "notification_deliveries" ("notification_id","channel","recipient");--> statement-breakpoint
DROP INDEX IF EXISTS "deliveries_notification_channel_uq";--> statement-breakpoint
CREATE INDEX "deliveries_ticket_document_idx" ON "notification_deliveries" ("ticket_document_id") WHERE "ticket_document_id" is not null;--> statement-breakpoint
-- D8: the new permissions for roles that already exist (new installs get them from the seed).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p.permission FROM "roles" r
CROSS JOIN (VALUES ('ticket.document.issue'), ('ticket.document.resend')) AS p(permission)
WHERE r."key" IN ('admin', 'owner')
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "users" SET "perm_version" = "perm_version" + 1
WHERE "id" IN (SELECT ur."user_id" FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE r."key" IN ('admin', 'owner'));

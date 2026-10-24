-- ADR-0005: identity verification (Phase B). Hand-written like 0001 and 0003; the journal entry is added by hand.
ALTER TABLE "customer_profiles" ADD COLUMN "address_line1" varchar(120);--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "address_line2" varchar(120);--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "address_city" varchar(80);--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "address_postcode" varchar(12);--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "address_country" varchar(2);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "storage_bucket" varchar(80);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "traveller_documents" ADD COLUMN "verification_status" text DEFAULT 'UNVERIFIED' NOT NULL;--> statement-breakpoint
ALTER TABLE "traveller_documents" ADD COLUMN "scan_document_id" uuid;--> statement-breakpoint
ALTER TABLE "traveller_documents" ADD COLUMN "customer_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "traveller_documents" ADD COLUMN "confirmed_values_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "traveller_documents" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "traveller_documents" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "traveller_documents" ADD CONSTRAINT "traveller_documents_verification_status_check" CHECK ("verification_status" IN ('UNVERIFIED','SUBMITTED','VERIFIED','REJECTED','CORRECTION_REQUIRED'));--> statement-breakpoint
ALTER TABLE "traveller_documents" ADD CONSTRAINT "traveller_documents_scan_document_id_documents_id_fk" FOREIGN KEY ("scan_document_id") REFERENCES "documents"("id");--> statement-breakpoint
CREATE INDEX "traveller_documents_verification_idx" ON "traveller_documents" ("verification_status");--> statement-breakpoint
CREATE TABLE "verification_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"traveller_document_id" uuid NOT NULL REFERENCES "traveller_documents"("id"),
	"traveller_id" uuid NOT NULL REFERENCES "travellers"("id"),
	"decision" text NOT NULL CHECK ("decision" IN ('VERIFIED','REJECTED','CORRECTION_REQUIRED')),
	"reason_code" varchar(40),
	"reason_text" text,
	"reviewer_user_id" uuid NOT NULL REFERENCES "users"("id"),
	"value_hash" varchar(64) NOT NULL,
	"scan_document_id" uuid REFERENCES "documents"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "verification_reviews_document_idx" ON "verification_reviews" ("traveller_document_id");--> statement-breakpoint
-- Insert-only, like compliance_decisions: the trigger also stops the table owner; migrate.ts removes UPDATE/DELETE from app_rw.
CREATE TRIGGER verification_reviews_append_only BEFORE UPDATE OR DELETE ON verification_reviews FOR EACH ROW EXECUTE FUNCTION forbid_mutation();--> statement-breakpoint
-- identity.verify for roles that already exist (new installs get it from the seed).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", 'identity.verify' FROM "roles" r WHERE r."key" IN ('admin', 'owner')
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "users" SET "perm_version" = "perm_version" + 1
WHERE "id" IN (SELECT ur."user_id" FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE r."key" IN ('admin', 'owner'));

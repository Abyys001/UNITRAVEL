-- STAGE-26: service catalogue, customer interests on flight requests, external booking reference (ADR-0030). Hand-written like 0003-0020; the journal entry is added by hand.
CREATE TABLE "service_catalog_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"name_fa" varchar(120) NOT NULL,
	"description_en" text,
	"description_fa" text,
	"line_type" varchar(20) NOT NULL,
	"default_price_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"per_passenger" boolean DEFAULT false NOT NULL,
	"show_price_to_customer" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_catalog_items_code_unique" UNIQUE("code"),
	CONSTRAINT "service_catalog_price_chk" CHECK ("default_price_minor" >= 0)
);--> statement-breakpoint
ALTER TABLE "service_catalog_items" ADD CONSTRAINT "service_catalog_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "request_service_interests" (
	"request_id" uuid NOT NULL,
	"catalogue_item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "request_service_interests" ADD CONSTRAINT "request_service_interests_request_id_flight_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."flight_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_service_interests" ADD CONSTRAINT "request_service_interests_catalogue_item_id_service_catalog_items_id_fk" FOREIGN KEY ("catalogue_item_id") REFERENCES "public"."service_catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rsi_pair_uq" ON "request_service_interests" USING btree ("request_id","catalogue_item_id");--> statement-breakpoint
CREATE INDEX "rsi_request_idx" ON "request_service_interests" USING btree ("request_id");--> statement-breakpoint
-- ADR-0030: a reservation needs a PNR or the external panel's own reference.
ALTER TABLE "reservations" ALTER COLUMN "record_locator" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "external_reference" varchar(64);--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_ref_chk" CHECK ("record_locator" IS NOT NULL OR "external_reference" IS NOT NULL);--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p.permission FROM "roles" r
JOIN (VALUES ('admin', 'service_catalog.manage'), ('owner', 'service_catalog.manage')) AS p(role_key, permission) ON p.role_key = r."key"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "users" SET "perm_version" = "perm_version" + 1
WHERE "id" IN (SELECT ur."user_id" FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE r."key" IN ('admin', 'owner'));

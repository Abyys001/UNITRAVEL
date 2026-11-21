-- STAGE-33 / ADR-0042: cargo tracking numbers, drivers, assignments, proof, labels, milestone notification log.
-- Hand-written like 0003-0024; the journal entry is added by hand. Templates and the `driver` role come from the seed.
ALTER TABLE "cargo_requests" ADD COLUMN "tracking_number" varchar(13);--> statement-breakpoint
ALTER TABLE "cargo_requests" ADD COLUMN "tracking_number_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cargo_requests" ADD COLUMN "preferred_delivery_date" date;--> statement-breakpoint
ALTER TABLE "cargo_requests" ADD COLUMN "handling_instructions" text;--> statement-breakpoint
ALTER TABLE "cargo_requests" ADD CONSTRAINT "cargo_requests_tracking_number_unique" UNIQUE("tracking_number");--> statement-breakpoint
ALTER TABLE "cargo_requests" ADD CONSTRAINT "cargo_requests_tracking_number_chk" CHECK ("tracking_number" IS NULL OR "tracking_number" ~ '^UT[0-9]{11}$');--> statement-breakpoint
CREATE TABLE "cargo_drivers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"email" varchar(200) NOT NULL,
	"phone" varchar(32),
	"vehicle" varchar(120),
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cargo_drivers_user_id_unique" UNIQUE("user_id")
);--> statement-breakpoint
ALTER TABLE "cargo_drivers" ADD CONSTRAINT "cargo_drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_drivers" ADD CONSTRAINT "cargo_drivers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "cargo_driver_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cargo_request_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'ASSIGNED' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"note" text,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "cda_kind_chk" CHECK ("kind" IN ('COLLECTION', 'DELIVERY')),
	CONSTRAINT "cda_status_chk" CHECK ("status" IN ('ASSIGNED', 'COMPLETED', 'FAILED', 'CANCELLED'))
);--> statement-breakpoint
ALTER TABLE "cargo_driver_assignments" ADD CONSTRAINT "cda_request_fk" FOREIGN KEY ("cargo_request_id") REFERENCES "public"."cargo_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_driver_assignments" ADD CONSTRAINT "cda_driver_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."cargo_drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_driver_assignments" ADD CONSTRAINT "cda_assigned_by_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cda_driver_idx" ON "cargo_driver_assignments" USING btree ("driver_id","status");--> statement-breakpoint
CREATE INDEX "cda_request_idx" ON "cargo_driver_assignments" USING btree ("cargo_request_id");--> statement-breakpoint
-- One active job of each kind per shipment.
CREATE UNIQUE INDEX "cda_active_uq" ON "cargo_driver_assignments" ("cargo_request_id", "kind") WHERE "status" = 'ASSIGNED';--> statement-breakpoint
CREATE TABLE "cargo_delivery_proofs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cargo_request_id" uuid NOT NULL,
	"assignment_id" uuid,
	"kind" text NOT NULL,
	"receiver_name" varchar(120),
	"signature_document_id" uuid,
	"photo_document_ids" uuid[] DEFAULT '{}' NOT NULL,
	"location" varchar(120) NOT NULL,
	"note" text,
	"captured_by" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cdp_kind_chk" CHECK ("kind" IN ('COLLECTION', 'DELIVERY'))
);--> statement-breakpoint
ALTER TABLE "cargo_delivery_proofs" ADD CONSTRAINT "cdp_request_fk" FOREIGN KEY ("cargo_request_id") REFERENCES "public"."cargo_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_delivery_proofs" ADD CONSTRAINT "cdp_assignment_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."cargo_driver_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_delivery_proofs" ADD CONSTRAINT "cdp_captured_by_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cdp_request_idx" ON "cargo_delivery_proofs" USING btree ("cargo_request_id");--> statement-breakpoint
CREATE TABLE "cargo_labels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cargo_request_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"format" varchar(4) NOT NULL,
	"pieces" integer NOT NULL,
	"tracking_number" varchar(13) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "cargo_labels" ADD CONSTRAINT "cargo_labels_request_fk" FOREIGN KEY ("cargo_request_id") REFERENCES "public"."cargo_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_labels" ADD CONSTRAINT "cargo_labels_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cargo_labels_request_idx" ON "cargo_labels" USING btree ("cargo_request_id");--> statement-breakpoint
CREATE TABLE "cargo_notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cargo_request_id" uuid NOT NULL,
	"key" varchar(80) NOT NULL,
	"milestone" varchar(40) NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"outbox_event_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "cargo_notifications" ADD CONSTRAINT "cargo_notifications_request_fk" FOREIGN KEY ("cargo_request_id") REFERENCES "public"."cargo_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cargo_notifications_uq" ON "cargo_notifications" USING btree ("cargo_request_id","key");--> statement-breakpoint
CREATE INDEX "cargo_notifications_created_idx" ON "cargo_notifications" USING btree ("created_at");--> statement-breakpoint
-- New permissions on the existing roles (the seed adds the `driver` role itself).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p.permission FROM "roles" r
JOIN (VALUES ('admin', 'cargo_driver.manage'), ('cargo_admin', 'cargo_driver.manage'), ('owner', 'cargo_driver.manage'), ('owner', 'cargo_job.driver')) AS p(role_key, permission) ON p.role_key = r."key"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "users" SET "perm_version" = "perm_version" + 1
WHERE "id" IN (SELECT ur."user_id" FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE r."key" IN ('admin', 'cargo_admin', 'owner'));

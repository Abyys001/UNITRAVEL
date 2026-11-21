-- STAGE-33 / ADR-0042 D10a + D13: recipient notices logged beside customer notices; requests staff create for a customer.
ALTER TABLE "cargo_notifications" ADD COLUMN "audience" varchar(12) DEFAULT 'CUSTOMER' NOT NULL;--> statement-breakpoint
ALTER TABLE "cargo_notifications" ADD COLUMN "recipient_email" varchar(200);--> statement-breakpoint
ALTER TABLE "cargo_notifications" ADD COLUMN "delivery_status" varchar(16);--> statement-breakpoint
ALTER TABLE "cargo_notifications" ADD COLUMN "delivery_error" text;
--> statement-breakpoint
-- ADR-0042 D13: requests staff created on a customer's behalf.
ALTER TABLE "cargo_requests" ADD COLUMN "created_by_staff_id" uuid REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "cargo_requests" ADD COLUMN "intake_channel" varchar(12) DEFAULT 'ONLINE' NOT NULL;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p.permission FROM "roles" r
JOIN (VALUES ('admin', 'cargo_request.create.any'), ('cargo_admin', 'cargo_request.create.any'), ('owner', 'cargo_request.create.any')) AS p(role_key, permission) ON p.role_key = r."key"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "users" SET "perm_version" = "perm_version" + 1
WHERE "id" IN (SELECT ur."user_id" FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE r."key" IN ('admin', 'cargo_admin', 'owner'));

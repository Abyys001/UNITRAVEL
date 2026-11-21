-- ADR-0044: staff-created flight requests and ticketing without identity verification (staff override with a reason).
ALTER TABLE "flight_requests" ADD COLUMN "identity_override_reason" text;--> statement-breakpoint
ALTER TABLE "flight_requests" ADD COLUMN "identity_override_by" uuid REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "flight_requests" ADD COLUMN "identity_override_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "flight_requests" ADD COLUMN "created_by_staff_id" uuid REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "flight_requests" ADD COLUMN "intake_channel" varchar(12) DEFAULT 'ONLINE' NOT NULL;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p.permission FROM "roles" r
JOIN (VALUES ('admin', 'flight_request.create.any'), ('owner', 'flight_request.create.any')) AS p(role_key, permission) ON p.role_key = r."key"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "users" SET "perm_version" = "perm_version" + 1
WHERE "id" IN (SELECT ur."user_id" FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE r."key" IN ('admin', 'owner'));

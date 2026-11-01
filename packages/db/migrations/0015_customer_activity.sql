-- ADR-0018: customer activity telemetry (sign-in, sign-out, screen name). Hand-written like 0003-0014; the journal entry is added by hand.
-- Screen names only, no content; pruned after 90 days by the worker job activity.prune.
CREATE TABLE "customer_activity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"session_id" uuid,
	"kind" text NOT NULL CHECK ("kind" IN ('SIGN_IN','SIGN_OUT','SCREEN_VIEW')),
	"screen" varchar(40),
	"ref" varchar(32),
	"client" text CHECK ("client" IN ('WEB','MOBILE','CONSOLE')),
	"network" varchar(64),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_activity_screen_view" CHECK ("kind" <> 'SCREEN_VIEW' OR "screen" IS NOT NULL)
);--> statement-breakpoint
CREATE INDEX "customer_activity_user_idx" ON "customer_activity" ("user_id", "occurred_at");--> statement-breakpoint
CREATE INDEX "customer_activity_at_idx" ON "customer_activity" ("occurred_at");--> statement-breakpoint
CREATE INDEX "users_last_active_idx" ON "users" ("last_active_at");--> statement-breakpoint
-- New permissions for roles that already exist (new installs get them from the seed). The Phase J permissions for support,
-- calls, assignments and listings are included here so one migration keeps the catalogue and the database in agreement.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p.permission FROM "roles" r
JOIN (VALUES
	('admin', 'customer.read'), ('admin', 'service.assign'), ('admin', 'support.read'), ('admin', 'support.reply'), ('admin', 'call.log'), ('admin', 'listings.write'),
	('owner', 'customer.read'), ('owner', 'service.assign'), ('owner', 'support.read'), ('owner', 'support.reply'), ('owner', 'call.log'), ('owner', 'listings.write')
) AS p(role_key, permission) ON p.role_key = r."key"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "users" SET "perm_version" = "perm_version" + 1
WHERE "id" IN (SELECT ur."user_id" FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE r."key" IN ('admin', 'owner'));

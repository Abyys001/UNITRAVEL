-- ADR-0004: pricing permissions for roles that already exist (new installs get them from the seed).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p.permission FROM "roles" r
CROSS JOIN (VALUES ('pricing.read.internal'), ('pricing.write'), ('commercial_document.issue')) AS p(permission)
WHERE r."key" IN ('admin', 'owner')
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Sessions carry permissions in the token; bump the version so holders refresh them.
UPDATE "users" SET "perm_version" = "perm_version" + 1
WHERE "id" IN (SELECT ur."user_id" FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE r."key" IN ('admin', 'owner'));

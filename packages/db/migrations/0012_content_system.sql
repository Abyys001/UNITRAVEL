-- ADR-0017: content system. Hand-written like 0003-0011; the journal entry is added by hand.
CREATE TABLE "cms_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL CHECK ("kind" IN ('ARTICLE','GUIDE','LEGAL','PAGE')),
	"locale" varchar(2) NOT NULL CHECK ("locale" IN ('en','fa')),
	"slug" varchar(80) NOT NULL,
	"title" varchar(160) NOT NULL,
	"summary" varchar(400) DEFAULT '' NOT NULL,
	"body_md" text NOT NULL,
	"category" varchar(40),
	"tags" jsonb DEFAULT '[]' NOT NULL,
	"featured_image" varchar(300),
	"image_alt" varchar(200),
	"seo_title" varchar(70),
	"seo_description" varchar(170),
	"related_services" jsonb DEFAULT '[]' NOT NULL,
	"claims_to_verify" jsonb DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL CHECK ("status" IN ('DRAFT','IN_REVIEW','PUBLISHED','ARCHIVED')),
	"publish_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"author_id" uuid NOT NULL REFERENCES "users"("id"),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_published_needs_no_claims" CHECK ("status" <> 'PUBLISHED' OR jsonb_array_length("claims_to_verify") = 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "cms_entries_slug_uq" ON "cms_entries" ("kind", "locale", "slug");--> statement-breakpoint
CREATE INDEX "cms_entries_list_idx" ON "cms_entries" ("kind", "locale", "status", "published_at");--> statement-breakpoint
CREATE TABLE "cms_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL REFERENCES "cms_entries"("id"),
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"title" varchar(160) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_by" uuid NOT NULL REFERENCES "users"("id"),
	"note" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "cms_revisions_entry_version_uq" ON "cms_revisions" ("entry_id", "version", "status");--> statement-breakpoint
CREATE TABLE "cms_redirects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"locale" varchar(2) NOT NULL,
	"from_slug" varchar(80) NOT NULL,
	"to_slug" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "cms_redirects_from_uq" ON "cms_redirects" ("kind", "locale", "from_slug");--> statement-breakpoint
CREATE TABLE "glossary_terms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(80) NOT NULL UNIQUE,
	"term_fa" varchar(120) NOT NULL,
	"term_en" varchar(120) NOT NULL,
	"explanation_fa" text NOT NULL,
	"explanation_en" text DEFAULT '' NOT NULL,
	"category" text NOT NULL CHECK ("category" IN ('FLIGHT','BAGGAGE','CLASS','HOTEL','ROOM','MEAL')),
	"related" jsonb DEFAULT '[]' NOT NULL,
	"service" varchar(16),
	"status" text DEFAULT 'DRAFT' NOT NULL CHECK ("status" IN ('DRAFT','IN_REVIEW','PUBLISHED','ARCHIVED')),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "glossary_terms_cat_idx" ON "glossary_terms" ("category", "status");--> statement-breakpoint
-- Permissions for roles that already exist (new installs get them from the seed). cms.publish is owner only.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p.permission FROM "roles" r
JOIN (VALUES
	('admin', 'cms.read'), ('admin', 'cms.write'),
	('owner', 'cms.read'), ('owner', 'cms.write'), ('owner', 'cms.publish')
) AS p(role_key, permission) ON p.role_key = r."key"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "users" SET "perm_version" = "perm_version" + 1
WHERE "id" IN (SELECT ur."user_id" FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE r."key" IN ('admin', 'owner'));

-- ADR-0028: direct invoices typed by staff, with no quote behind them.
ALTER TABLE "invoices" ADD COLUMN "origin" text DEFAULT 'QUOTE' NOT NULL CHECK ("origin" IN ('QUOTE','DIRECT'));--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "due_days" integer CHECK ("due_days" BETWEEN 1 AND 365);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "quote_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_origin_quote_ck" CHECK (("origin" = 'QUOTE') = ("quote_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "service_type" varchar(20);--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p.permission FROM "roles" r
JOIN (VALUES ('admin', 'invoice.direct'), ('owner', 'invoice.direct')) AS p(role_key, permission) ON p.role_key = r."key"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "users" SET "perm_version" = "perm_version" + 1
WHERE "id" IN (SELECT ur."user_id" FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE r."key" IN ('admin', 'owner'));--> statement-breakpoint
-- ADR-0028 D8: invoice emails carry the services, total, due date and a PDF. Rows staff have edited are left alone.
UPDATE "notification_templates" SET "body" = E'Invoice {number} ({ref}) has been issued.\n\nServices:\n{services}\n\nTotal: {total}\nPay by: {expires_at_local}\n\nThe PDF is attached. Sign in to view and pay this invoice:\n{link}', "variables" = ARRAY['ref','number','expires_at_local','link','services','total'], "version" = "version" + 1
WHERE "event_type" = 'invoice.issued' AND "channel" = 'EMAIL' AND "locale" = 'en' AND "updated_by" IS NULL;--> statement-breakpoint
UPDATE "notification_templates" SET "body" = E'فاکتور {number} ({ref}) صادر شد.\n\nخدمات:\n{services}\n\nمبلغ کل: {total}\nمهلت پرداخت: {expires_at_local}\n\nفایل PDF پیوست است. برای دیدن و پرداخت این فاکتور وارد شوید:\n{link}', "variables" = ARRAY['ref','number','expires_at_local','link','services','total'], "version" = "version" + 1
WHERE "event_type" = 'invoice.issued' AND "channel" = 'EMAIL' AND "locale" = 'fa' AND "updated_by" IS NULL;--> statement-breakpoint
UPDATE "notification_templates" SET "body" = E'Invoice {number} ({ref}) is awaiting payment.\n\nServices:\n{services}\n\nTotal: {total}\nPay by: {expires_at_local}\n\nThe PDF is attached. Sign in to view and pay this invoice:\n{link}', "variables" = ARRAY['ref','number','expires_at_local','link','services','total'], "version" = "version" + 1
WHERE "event_type" = 'payment.requested' AND "channel" = 'EMAIL' AND "locale" = 'en' AND "updated_by" IS NULL;--> statement-breakpoint
UPDATE "notification_templates" SET "body" = E'فاکتور {number} ({ref}) در انتظار پرداخت است.\n\nخدمات:\n{services}\n\nمبلغ کل: {total}\nمهلت پرداخت: {expires_at_local}\n\nفایل PDF پیوست است. برای دیدن و پرداخت این فاکتور وارد شوید:\n{link}', "variables" = ARRAY['ref','number','expires_at_local','link','services','total'], "version" = "version" + 1
WHERE "event_type" = 'payment.requested' AND "channel" = 'EMAIL' AND "locale" = 'fa' AND "updated_by" IS NULL;

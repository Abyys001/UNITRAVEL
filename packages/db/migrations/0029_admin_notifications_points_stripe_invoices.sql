-- ADR-0039: admin notifications, club points, Stripe invoices. Hand-written like 0003-0031; the journal entry is added by hand. Additive only.
-- D1: inbox templates of the staff feed (new installs also get them from the seed).
INSERT INTO "notification_templates" ("id", "event_type", "channel", "locale", "title", "body", "variables") VALUES
(gen_random_uuid(), 'staff.request_submitted', 'INBOX', 'en', 'New flight request · {ref}', 'A customer submitted {ref} ({route}).', ARRAY['ref','route']),
(gen_random_uuid(), 'staff.request_submitted', 'INBOX', 'fa', 'درخواست پرواز جدید · {ref}', 'مشتری درخواست {ref} ({route}) را ثبت کرد.', ARRAY['ref','route']),
(gen_random_uuid(), 'staff.cargo_submitted', 'INBOX', 'en', 'New cargo request · {ref}', 'A customer submitted {ref} ({route}).', ARRAY['ref','route']),
(gen_random_uuid(), 'staff.cargo_submitted', 'INBOX', 'fa', 'درخواست بار جدید · {ref}', 'مشتری درخواست بار {ref} ({route}) را ثبت کرد.', ARRAY['ref','route']),
(gen_random_uuid(), 'staff.customer_message', 'INBOX', 'en', 'Customer message · {ref}', 'The customer wrote on {ref}.', ARRAY['ref']),
(gen_random_uuid(), 'staff.customer_message', 'INBOX', 'fa', 'پیام مشتری · {ref}', 'مشتری در {ref} پیام فرستاد.', ARRAY['ref']),
(gen_random_uuid(), 'staff.quote_accepted', 'INBOX', 'en', 'Quote accepted · {ref}', 'The quote on {ref} was accepted. Next: reserve and invoice.', ARRAY['ref']),
(gen_random_uuid(), 'staff.quote_accepted', 'INBOX', 'fa', 'پیشنهاد قیمت پذیرفته شد · {ref}', 'پیشنهاد قیمت {ref} پذیرفته شد. گام بعد: رزرو و صدور فاکتور.', ARRAY['ref']),
(gen_random_uuid(), 'staff.service_submitted', 'INBOX', 'en', 'New service request · {ref}', 'A customer asked for {service} ({ref}).', ARRAY['ref','service']),
(gen_random_uuid(), 'staff.service_submitted', 'INBOX', 'fa', 'درخواست خدمت جدید · {ref}', 'مشتری درخواست {service} ({ref}) را ثبت کرد.', ARRAY['ref','service']),
(gen_random_uuid(), 'staff.service_message', 'INBOX', 'en', 'Customer message · {ref}', 'The customer wrote on service request {ref}.', ARRAY['ref']),
(gen_random_uuid(), 'staff.service_message', 'INBOX', 'fa', 'پیام مشتری · {ref}', 'مشتری در درخواست خدمت {ref} پیام فرستاد.', ARRAY['ref']),
(gen_random_uuid(), 'staff.support_ticket', 'INBOX', 'en', 'New support message · {ref}', 'A new support message arrived ({topic}).', ARRAY['ref','topic']),
(gen_random_uuid(), 'staff.support_ticket', 'INBOX', 'fa', 'پیام پشتیبانی جدید · {ref}', 'پیام پشتیبانی جدیدی رسید ({topic}).', ARRAY['ref','topic']),
(gen_random_uuid(), 'staff.support_reply', 'INBOX', 'en', 'Customer replied · {ref}', 'The customer answered support ticket {ref}.', ARRAY['ref']),
(gen_random_uuid(), 'staff.support_reply', 'INBOX', 'fa', 'پاسخ مشتری · {ref}', 'مشتری به تیکت پشتیبانی {ref} پاسخ داد.', ARRAY['ref']),
(gen_random_uuid(), 'staff.invoice_paid', 'INBOX', 'en', 'Invoice paid · {number}', 'Invoice {number} was paid in full.', ARRAY['number']),
(gen_random_uuid(), 'staff.invoice_paid', 'INBOX', 'fa', 'فاکتور پرداخت شد · {number}', 'فاکتور {number} به‌طور کامل پرداخت شد.', ARRAY['number']),
(gen_random_uuid(), 'staff.identity_submitted', 'INBOX', 'en', 'Passport to check · {name}', 'A customer confirmed passport details for {name}. Check them in Identity checks.', ARRAY['name']),
(gen_random_uuid(), 'staff.identity_submitted', 'INBOX', 'fa', 'گذرنامه برای بررسی · {name}', 'مشتری مشخصات گذرنامهٔ {name} را تأیید کرد. آن را در بررسی هویت بررسی کنید.', ARRAY['name'])
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- D3: club points, staff-managed. Insert-only: corrections are new rows.
CREATE TABLE "loyalty_points_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"kind" text NOT NULL CHECK ("kind" IN ('GRANTED','DEDUCTED')),
	"delta" integer NOT NULL,
	"reason" text NOT NULL CHECK (length(btrim("reason")) > 0),
	"customer_note" text,
	"actor_user_id" uuid NOT NULL REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_points_sign" CHECK (("kind" = 'GRANTED' AND "delta" > 0) OR ("kind" = 'DEDUCTED' AND "delta" < 0))
);--> statement-breakpoint
CREATE INDEX "loyalty_points_ledger_user_idx" ON "loyalty_points_ledger" ("user_id", "created_at");--> statement-breakpoint
CREATE TRIGGER loyalty_points_ledger_append_only BEFORE UPDATE OR DELETE ON loyalty_points_ledger FOR EACH ROW EXECUTE FUNCTION forbid_mutation();--> statement-breakpoint
-- D4: Stripe Customer per user and account; Stripe Invoice per invoice (one live at a time).
CREATE TABLE "stripe_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"account_key" varchar(64) NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL CHECK ("mode" IN ('test','live')),
	"stripe_customer_id" varchar(255) NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_customers_user_account_uq" ON "stripe_customers" ("user_id", "account_key", "mode");--> statement-breakpoint
CREATE TABLE "stripe_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL REFERENCES "invoices"("id"),
	"mode" text DEFAULT 'test' NOT NULL CHECK ("mode" IN ('test','live')),
	"account_key" varchar(64) NOT NULL,
	"status" text DEFAULT 'CREATING' NOT NULL CHECK ("status" IN ('CREATING','DRAFT','OPEN','PAID','VOID','UNCOLLECTIBLE','FAILED')),
	"attempt" integer DEFAULT 1 NOT NULL,
	"stripe_invoice_id" varchar(255) UNIQUE,
	"stripe_customer_id" varchar(255),
	"amount_due_minor" bigint,
	"amount_paid_minor" bigint,
	"currency" varchar(3) NOT NULL,
	"hosted_invoice_url" text,
	"invoice_pdf_url" text,
	"payment_intent_id" varchar(255),
	"last_error" text,
	"created_by" uuid REFERENCES "users"("id"),
	"finalized_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "stripe_invoices_invoice_idx" ON "stripe_invoices" ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_invoices_one_live_per_invoice_uq" ON "stripe_invoices" ("invoice_id") WHERE "status" IN ('CREATING','DRAFT','OPEN','PAID');

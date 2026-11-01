-- ADR-0019, plan J5: support tickets, messages and the call log. Hand-written like 0003-0015; the journal entry is added by hand.
-- Permissions support.read, support.reply and call.log were granted to admin and owner in 0015.
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" varchar(12) NOT NULL UNIQUE,
	"status" text DEFAULT 'OPEN' NOT NULL CHECK ("status" IN ('OPEN','PENDING_CUSTOMER','RESOLVED','CLOSED')),
	"topic" text NOT NULL CHECK ("topic" IN ('BOOKING','PAYMENT','DOCUMENTS','VISA','CARGO','ACCOUNT','FEEDBACK','OTHER')),
	"subject" varchar(160) NOT NULL,
	"user_id" uuid REFERENCES "users"("id"),
	"contact_name" varchar(80) NOT NULL,
	"contact_email" varchar(254),
	"contact_phone" varchar(32),
	"request_ref" varchar(20),
	"locale" text DEFAULT 'en' NOT NULL CHECK ("locale" IN ('en','fa')),
	"assignee_user_id" uuid REFERENCES "users"("id"),
	"sla_due_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_tickets_contact" CHECK ("user_id" IS NOT NULL OR "contact_email" IS NOT NULL OR "contact_phone" IS NOT NULL)
);--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" ("status", "sla_due_at");--> statement-breakpoint
CREATE INDEX "support_tickets_user_idx" ON "support_tickets" ("user_id", "created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_assignee_idx" ON "support_tickets" ("assignee_user_id", "status");--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id"),
	"kind" text NOT NULL CHECK ("kind" IN ('CUSTOMER','STAFF','INTERNAL')),
	"author_user_id" uuid REFERENCES "users"("id"),
	"author_name" varchar(120) NOT NULL,
	"body" text NOT NULL,
	"email_queued" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "support_messages_ticket_idx" ON "support_messages" ("ticket_id", "created_at");--> statement-breakpoint
CREATE TABLE "call_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"direction" text NOT NULL CHECK ("direction" IN ('INBOUND','OUTBOUND')),
	"from_number" varchar(32) NOT NULL,
	"to_number" varchar(32) NOT NULL,
	"duration_seconds" integer NOT NULL CHECK ("duration_seconds" >= 0),
	"status" text NOT NULL CHECK ("status" IN ('ANSWERED','MISSED','BUSY','FAILED','VOICEMAIL')),
	"started_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL CHECK ("source" IN ('MANUAL','BONLINE')),
	"provider_ref" varchar(120),
	"ticket_id" uuid REFERENCES "support_tickets"("id"),
	"user_id" uuid REFERENCES "users"("id"),
	"recorded_by" uuid REFERENCES "users"("id"),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "call_logs_started_idx" ON "call_logs" ("started_at");--> statement-breakpoint
CREATE INDEX "call_logs_ticket_idx" ON "call_logs" ("ticket_id");--> statement-breakpoint
CREATE INDEX "call_logs_user_idx" ON "call_logs" ("user_id", "started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "call_logs_provider_uq" ON "call_logs" ("source", "provider_ref") WHERE provider_ref IS NOT NULL;

-- Remembered console devices (ADR-0022): only a token hash is stored. A device can open new sessions until it lapses or is revoked.
CREATE TABLE "trusted_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"host" varchar(255) NOT NULL,
	"user_agent" varchar(400),
	"token_hash" varchar(128) NOT NULL UNIQUE,
	"previous_token_hash" varchar(128),
	"rotated_at" timestamp with time zone,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "trusted_devices_user_idx" ON "trusted_devices" ("user_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "trusted_device_id" uuid REFERENCES "trusted_devices"("id");

-- ADR-0045: agent sign-in QR codes (single use, 10 minutes, hash only).
CREATE TABLE "agent_sign_in_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL REFERENCES "cargo_agents"("id"),
	"token_hash" varchar(64) NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"session_id" uuid,
	"created_by" uuid NOT NULL REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "asic_agent_idx" ON "agent_sign_in_codes" ("agent_id");

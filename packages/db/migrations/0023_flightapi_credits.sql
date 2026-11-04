-- ADR-0035: FlightAPI as a second catalog source, metered in credits. Hand-written like 0003-0022; the journal entry is added by hand.
ALTER TABLE "provider_usage_ledger" ADD COLUMN "credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_usage_ledger" ADD COLUMN "meta" jsonb;

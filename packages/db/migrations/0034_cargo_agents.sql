-- ADR-0043: drivers become agents (couriers, drivers, collection/delivery agents, logistics representatives).
-- Renames the 0032 tables and role, adds Agent IDs, types, responsibilities, photos, acceptance, handling jobs and multiple agents per job.
ALTER TABLE "cargo_drivers" RENAME TO "cargo_agents";--> statement-breakpoint
CREATE SEQUENCE "cargo_agent_code_seq" START 1;--> statement-breakpoint
ALTER TABLE "cargo_agents" ADD COLUMN "agent_code" varchar(12) DEFAULT ('AG-' || lpad(nextval('cargo_agent_code_seq')::text, 5, '0')) NOT NULL;--> statement-breakpoint
ALTER TABLE "cargo_agents" ADD CONSTRAINT "cargo_agents_agent_code_unique" UNIQUE("agent_code");--> statement-breakpoint
ALTER TABLE "cargo_agents" ADD COLUMN "public_name" varchar(80);--> statement-breakpoint
ALTER TABLE "cargo_agents" ADD COLUMN "agent_type" varchar(30) DEFAULT 'DRIVER' NOT NULL;--> statement-breakpoint
ALTER TABLE "cargo_agents" ADD COLUMN "responsibilities" text[] DEFAULT '{COLLECTION,DELIVERY}' NOT NULL;--> statement-breakpoint
ALTER TABLE "cargo_agents" ADD COLUMN "company" varchar(120);--> statement-breakpoint
ALTER TABLE "cargo_agents" ADD COLUMN "photo_document_id" uuid;--> statement-breakpoint
ALTER TABLE "cargo_agents" ADD COLUMN "requires_acceptance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cargo_agents" ADD CONSTRAINT "cargo_agents_type_chk" CHECK ("agent_type" IN ('DRIVER', 'COURIER', 'COLLECTION_AGENT', 'DELIVERY_AGENT', 'LOGISTICS_REPRESENTATIVE', 'OTHER'));--> statement-breakpoint
ALTER TABLE "cargo_driver_assignments" RENAME TO "cargo_agent_assignments";--> statement-breakpoint
ALTER TABLE "cargo_agent_assignments" RENAME COLUMN "driver_id" TO "agent_id";--> statement-breakpoint
ALTER INDEX IF EXISTS "cda_driver_idx" RENAME TO "cda_agent_idx";--> statement-breakpoint
ALTER TABLE "cargo_agent_assignments" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cargo_agent_assignments" ADD COLUMN "declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cargo_agent_assignments" ADD COLUMN "decline_reason" text;--> statement-breakpoint
ALTER TABLE "cargo_agent_assignments" DROP CONSTRAINT "cda_kind_chk";--> statement-breakpoint
ALTER TABLE "cargo_agent_assignments" ADD CONSTRAINT "cda_kind_chk" CHECK ("kind" IN ('COLLECTION', 'HANDLING', 'DELIVERY'));--> statement-breakpoint
ALTER TABLE "cargo_agent_assignments" DROP CONSTRAINT "cda_status_chk";--> statement-breakpoint
ALTER TABLE "cargo_agent_assignments" ADD CONSTRAINT "cda_status_chk" CHECK ("status" IN ('OFFERED', 'ASSIGNED', 'COMPLETED', 'FAILED', 'DECLINED', 'CANCELLED'));--> statement-breakpoint
-- Several agents may share a kind of job; the same agent holds it once while open.
DROP INDEX "cda_active_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "cda_active_uq" ON "cargo_agent_assignments" ("cargo_request_id", "kind", "agent_id") WHERE "status" IN ('OFFERED', 'ASSIGNED');--> statement-breakpoint
ALTER TABLE "cargo_delivery_proofs" DROP CONSTRAINT "cdp_assignment_fk";--> statement-breakpoint
ALTER TABLE "cargo_delivery_proofs" ADD CONSTRAINT "cdp_assignment_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."cargo_agent_assignments"("id");--> statement-breakpoint
-- Which agent recorded a tracking event (customers see only the agent's public name).
ALTER TABLE "tracking_events" ADD COLUMN "agent_id" uuid REFERENCES "cargo_agents"("id");--> statement-breakpoint
CREATE INDEX "tracking_agent_idx" ON "tracking_events" ("agent_id") WHERE "agent_id" IS NOT NULL;--> statement-breakpoint
-- Role and permissions: driver → agent.
UPDATE "roles" SET "key" = 'agent', "name" = 'Agent' WHERE "key" = 'driver' AND NOT EXISTS (SELECT 1 FROM "roles" WHERE "key" = 'agent');--> statement-breakpoint
UPDATE "role_permissions" SET "permission" = 'cargo_job.agent' WHERE "permission" = 'cargo_job.driver';--> statement-breakpoint
UPDATE "role_permissions" SET "permission" = 'cargo_agent.manage' WHERE "permission" = 'cargo_driver.manage';--> statement-breakpoint
UPDATE "users" SET "perm_version" = "perm_version" + 1
WHERE "id" IN (SELECT ur."user_id" FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE r."key" IN ('agent', 'admin', 'cargo_admin', 'owner'));

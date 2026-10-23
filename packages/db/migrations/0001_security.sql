-- Hand-written: partitions, immutability, matcher indexes, database roles (ch. 23.2, 23.12, 28.5).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- Monthly partitions. The maintenance job calls ensure_monthly_partitions() ahead of each month; a default
-- partition catches anything outside the created range so inserts never fail.
CREATE OR REPLACE FUNCTION ensure_monthly_partitions(parent text, months_ahead int DEFAULT 3) RETURNS void AS $$
DECLARE
  start_month date := date_trunc('month', now() - interval '1 month')::date;
  m date;
  part text;
BEGIN
  FOR i IN 0..months_ahead + 1 LOOP
    m := (start_month + (i || ' month')::interval)::date;
    part := format('%s_%s', parent, to_char(m, 'YYYYMM'));
    IF to_regclass(part) IS NULL THEN
      EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)', part, parent, m, (m + interval '1 month')::date);
    END IF;
  END LOOP;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS audit_log_default PARTITION OF audit_log DEFAULT;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS provider_calls_default PARTITION OF provider_calls DEFAULT;
--> statement-breakpoint
SELECT ensure_monthly_partitions('audit_log');
--> statement-breakpoint
SELECT ensure_monthly_partitions('provider_calls');
--> statement-breakpoint

-- Published configuration versions are immutable; the only allowed change is PUBLISHED → SUPERSEDED.
CREATE OR REPLACE FUNCTION config_versions_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    IF NEW.payload IS DISTINCT FROM OLD.payload OR NEW.version <> OLD.version OR NEW.domain <> OLD.domain
       OR NOT (OLD.status = 'PUBLISHED' AND NEW.status IN ('PUBLISHED', 'SUPERSEDED')) THEN
      RAISE EXCEPTION 'config_versions row % is immutable once published', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER config_versions_immutable BEFORE UPDATE ON config_versions FOR EACH ROW EXECUTE FUNCTION config_versions_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER offer_snapshots_append_only BEFORE UPDATE ON offer_snapshots FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER rsh_append_only BEFORE UPDATE ON request_status_history FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER decisions_append_only BEFORE UPDATE ON compliance_decisions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_append_only BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- Matcher candidate lookup (ch. 23.9: trigram and token indexes).
CREATE INDEX IF NOT EXISTS sanction_entries_tokens_gin ON sanction_entries USING gin (search_tokens);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sanction_entries_text_trgm ON sanction_entries USING gin (search_text gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS users_display_trgm ON users USING gin (display_name gin_trgm_ops);
--> statement-breakpoint

-- Roles (ch. 23.12). Passwords are set by migrate.ts from the environment; these statements only create the roles.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN CREATE ROLE app_rw LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN CREATE ROLE app_ro LOGIN; END IF;
END $$;

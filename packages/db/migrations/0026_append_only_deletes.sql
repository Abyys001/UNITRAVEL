-- Security hardening (ADR-0017): append-only tables refuse DELETE and TRUNCATE too, not only UPDATE. Before this,
-- removing the newest audit rows (or a status-history row) left no trace in the hash chain.
-- Retention never deletes rows from these tables; old audit partitions are detached or dropped by the owner role.
CREATE TRIGGER offer_snapshots_no_delete BEFORE DELETE ON offer_snapshots FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER rsh_no_delete BEFORE DELETE ON request_status_history FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON compliance_decisions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER offer_snapshots_no_truncate BEFORE TRUNCATE ON offer_snapshots FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER rsh_no_truncate BEFORE TRUNCATE ON request_status_history FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER decisions_no_truncate BEFORE TRUNCATE ON compliance_decisions FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

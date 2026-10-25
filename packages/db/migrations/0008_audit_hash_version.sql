-- Audit chain hash version (ch. 28.5). Version 1 rows hashed JSON.stringify of objects whose key order jsonb later changed, so their
-- content hash cannot be recomputed reliably; they are reported as legacy-unverifiable, never silently passed. Version 2 hashes canonical
-- (recursively key-sorted) JSON. audit_log is insert-only, so existing rows keep version 1 through the column default.
ALTER TABLE "audit_log" ADD COLUMN "hash_version" smallint DEFAULT 1 NOT NULL;

# Runbook: backup and restore

Booklet ch. 30.6. Targets: RPO at most 15 minutes, RTO at most 4 hours. Trigger: data loss or corruption, failed host, or the monthly restore test (restore into a scratch environment, timed and recorded).

## Policy (ch. 30.6, 28.6)
- PostgreSQL: nightly full backup plus continuous WAL archiving to encrypted object storage; point-in-time recovery for 7 days; daily backups for 35 days (backups are retained 35 days rolling, ch. 28.6). Backups encrypted with a separate key before upload (ch. 28.3).
- Object storage: versioning on; lifecycle rules for retention.
- Redis (Valkey): AOF persistence for queues; caches need no backup. Note SLA timers live there.
- Hosting region and provider for the production backup bucket: UNKNOWN (ch. 34.4); WAL archiving and PITR are the production design and are not configured by anything in this repository. `infra/compose.prod.yml` runs a single PostgreSQL service with a volume; PITR must be added on the chosen host or managed database.

## What the deployment does now (ADR-0017)
`infra/compose.prod.yml` runs `db-maintenance` (script `infra/scripts/db-maintenance.sh`, owner role): at start and then every 24 hours it calls `ensure_monthly_partitions` for `audit_log` and `provider_calls`, and writes `pg_dump --format=custom` to the `backups` volume as `unitravel-<UTC time>.dump`, deleting files older than `BACKUP_KEEP_DAYS` (default 14). Each run logs one line per step. These dumps are on the same host: copying them (and the `storage` volume) off the host, encrypting them with a key kept elsewhere, WAL archiving and PITR are still the operator's to set up. Restore a dump with `pg_restore -d <db> --no-owner --exit-on-error <file>`.

## Local drill (what is proven)
`scripts/backup-restore-drill.sh` (booklet ch. 30.6 monthly test, logical-dump form): `pg_dump -Fc` of the live database, restore into a scratch database `<name>_restore_drill`, row counts compared across every public table, scratch database dropped, dump deleted. Measured locally on 22-23 Oct 2026: dump 0.6 s, restore 2.7 s, 82 tables, row counts identical. This proves the dumps restore and the schema is restorable; it does not prove WAL archiving, PITR, encryption of backups or production-scale timings.

Run it: `PG_CONTAINER=<postgres container> SRC_DB=unitravel scripts/backup-restore-drill.sh`. Exit status 1 and "MISMATCH" mean the restore is not faithful.

## Trigger and first 15 minutes
1. Decide: corruption (bad migration, bad write) versus loss (host, disk). Stop writers to prevent further damage: stop `api` and `worker` (production: compose services; dev: `scripts/svc.sh stop api worker`). Leave `web` and `console` up to show a maintenance state if available.
2. Preserve the damaged database (rename or snapshot) before restoring.
3. Choose the recovery point: latest, or a PITR timestamp just before the damage (within 7 days). Record the chosen time.

## Restore
1. Provision or select the target PostgreSQL 18 instance (same major version).
2. Restore the base backup and replay WAL to the target time; or, for a logical dump, `pg_restore -d <db> --no-owner --exit-on-error <dump>`.
3. Recreate application roles and grants if not included (migrations role, `app_rw`, `app_ro`; insert-only grants on audit tables are created by the security migration). Run the `migrate` service to apply any missing migrations and confirm `GET /v1/dev/health` migration counts.
4. Verify integrity: row counts for key tables, `GET /v1/dev/audit-log/verify` (hash chain), latest `outbox_events`, a sample of requests with quotes and tickets, document rows against object storage (versioning allows recovery of deleted objects).
5. Valkey: if lost, queues and SLA timers are lost; see queue-backlog recovery for manual timer review. OTP and rate-limit state may reset.
6. Start `api` and `worker`; confirm `/ready`; run a smoke test (sign in as staff, open a request).
7. Events lost between the recovery point and the incident: reconcile from supplier records and customers' messages. RPO 15 minutes means up to 15 minutes of writes may be missing; list them from the outbox, inbox and audit sources that survived.

## Comms
Admins: maintenance and data-gap notice. Customers: only if their actions in the gap need repeating (quote acceptances, uploads). If personal data was exposed, follow security-incident.

## Follow-up
Record actual RPO and RTO against targets; record the monthly restore test result (date, dump size, durations, table count, row-count result) in this folder's log; fix gaps (PITR configuration, key custody for backup encryption).

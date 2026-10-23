# Runbook: database degradation

Booklet ch. 30.7, 30.2, 30.5. Trigger: p95 query time above 200 ms or connections above 80% of the limit.

## Impact
Slow API for everyone; the API stays up only while it can reach PostgreSQL. State changes are transactional (state, history, audit and outbox in one transaction), so failures should roll back cleanly rather than half-apply.

## Topology
PostgreSQL 18 (`postgres` service in infra/compose.prod.yml, or managed). Roles: migrations role, `app_rw` (insert-only on audit tables), `app_ro` (reports; `DATABASE_RO_URL`). Audit and some tables are partitioned monthly.

## First 15 minutes
1. `GET /v1/dev/health`: `database.ok`, `database.latencyMs`, migrations applied/latest.
2. On the database host, as an admin role: `select state, count(*) from pg_stat_activity group by 1;` against `max_connections`; list long-running queries and blocked locks via `pg_stat_activity` and `pg_locks`.
3. Check disk space and the volume (`pg` in compose), WAL archive health, and any running backup or migration.

## Diagnosis
| Pattern | Likely cause |
|---|---|
| Connections near limit | Pool sizing across api + worker, a leak, or a stuck transaction |
| One query dominating | Missing index, plan regression after data growth; use `EXPLAIN (ANALYZE, BUFFERS)` |
| Lock waits | Long transaction; a migration; a bulk job (list ingestion writes large batches) |
| I/O saturation | Backup or restore running at peak, autovacuum, or undersized volume |
| Everything slow after deploy | New migration or code path; compare with the previous release |

## Mitigation
- Terminate the offending backend (`pg_terminate_backend`) for idle-in-transaction sessions and runaway reports; prefer the read-only role for diagnostics.
- Reduce load: pause non-critical jobs by discarding or delaying them; sanctions list syncs run every 6 hours and can be postponed.
- Add the missing index through a normal reviewed migration (`pnpm db:migrate`, migrate image); avoid ad hoc DDL in production.
- If the instance is failing, fail over or restore: see backup-restore.

## Recovery
p95 under 200 ms and connections under 80% for 30 minutes; queues drain (queue-backlog); outbox pending near zero.

## Comms
Admins if staff screens are slow. Customers only if search or sign-in fails for more than a few minutes.

## Follow-up
Capture the slow query and plan; add the index or fix; review pool sizes; add a load-test scenario if the cause was load. Baselines for "connections" limit depend on hosting choice, still UNKNOWN (hosting region and provider, ch. 34.4).

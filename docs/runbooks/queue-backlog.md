# Runbook: queue backlog

Booklet ch. 30.7 and ch. 26.2. Trigger: oldest waiting job older than 2 minutes on a critical queue. Related SLOs (ch. 30.5): OTP SMS handed over within 3 s (99%), on-duty admin notification within 60 s (99%), outbox events dispatched within 5 s (99%).

## Impact
Delayed OTP, notifications and SLA timers; stale search progress; delayed compliance screening (requests wait in SUBMITTED); delayed document scanning.

## Mechanics
- Queues (apps/api/src/core/queues.ts): search.execute, supplier.call, notify.route, notify.sms, notify.push, notify.email, notify.escalate, timers.sla, compliance.screen, compliance.lists-sync, reference.sync, documents.scan, maintenance, events.misc. Retries use exponential backoff (5 attempts for notification queues). Failed jobs are retained (`removeOnFail:false`) and are the dead letters.
- The outbox (`outbox_events`) is written in the same transaction as the business row and dispatched by `outbox.dispatcher.ts` to queues; failed dispatch increments `attempts` and stores `lastError`.
- API and worker are separate processes (`main.api.ts`, `main.worker.ts`); workers heartbeat every 15 s into `process_heartbeats` with their config versions.
- Valkey runs with AOF and `noeviction` so jobs survive a restart (infra/compose.prod.yml).

## First 15 minutes
1. `GET /v1/dev/health`: per queue `waiting`, `active`, `delayed`, `failed`, `oldestWaitingSeconds`; `workers` (is any worker heartbeat within 60 s?); `outbox.pending` and `oldestSeconds`; `redis.ok`.
2. No worker heartbeats: the worker process is down. Restart it (production: restart the `worker` compose service; dev: `scripts/svc.sh restart worker`).
3. Workers alive, one queue stuck: look at `GET /v1/dev/queues/dead-letters` for the repeating error.

## Diagnosis
| Pattern | Cause |
|---|---|
| All queues stale, no heartbeats | Worker down or cannot reach Valkey/Postgres |
| notify.sms backlog | SMS provider slow or failing (sms-route-failure) |
| supplier.call/search.execute backlog | Provider limits, by design the gateway queues (supplier-outage; load test findings in STAGE-6) |
| outbox pending growing, queues empty | Dispatcher failing: read `outbox_events.last_error` |
| Redis not ok | Valkey down or out of memory (`noeviction` returns errors rather than evicting) |
| Config version mismatch across workers | Drift; reload or restart (ch. 16.3) |

## Mitigation
- Restart the stuck process. Scale workers only if the host has capacity; there is no autoscaling in this build.
- Retry a dead job after fixing the cause: `POST /v1/dev/jobs/{queue}/{id}/retry`. Discard poison jobs: `POST /v1/dev/jobs/{queue}/{id}/discard` (audited).
- Never flush Valkey: it holds SLA timers (BullMQ delayed jobs) and rate-limit state. If Valkey data was lost, SLA timers must be rebuilt (see recovery).

## Recovery
Oldest waiting age back under 2 minutes; outbox pending near zero; dead letters triaged. If Valkey was restored empty, note that SLA timers are delayed BullMQ jobs keyed by request and timer type (`modules/platform/timers.service.ts`); no automatic rebuild from database rows was found in code, so staff must manually review open requests for quote expiries, unassigned alerts and ticketing deadlines until a rebuild is added (follow-up).

## Comms
Admins: notifications may be late, check the New queue manually. Customers: none unless OTP was affected.

## Follow-up
Add a queue-age alert if absent; review concurrency settings; add a test for the failure mode.

# Runbooks

Source: booklet ch. 30.7 (trigger table) and ch. 30.6 (backup). Targets: ch. 30.5 SLOs. Written in Stage 6.

| Runbook | Trigger (ch. 30.7) |
|---|---|
| [supplier-outage](supplier-outage.md) | Circuit breaker open > 15 min |
| [sms-route-failure](sms-route-failure.md) | Delivery rate < 80% for a route over 30 min |
| [otp-abuse-spike](otp-abuse-spike.md) | OTP sends per country > 3x baseline, or conversion collapse |
| [queue-backlog](queue-backlog.md) | Oldest job age > 2 min on a critical queue |
| [database-degradation](database-degradation.md) | p95 query time > 200 ms or connections > 80% |
| [iran-reachability-loss](iran-reachability-loss.md) | External probes from Iran fail |
| [security-incident](security-incident.md) | Suspected breach (includes ICO 72-hour steps) |
| [sanctions-ingestion-failure](sanctions-ingestion-failure.md) | List sync failed twice in a row |
| [backup-restore](backup-restore.md) | Data loss, corruption, or the monthly restore test (ch. 30.6) |
| [identity-verification](identity-verification.md) | Staff procedure for passport verification (ADR-0005); not an incident trigger |
| [stripe-webhook-failure](stripe-webhook-failure.md) | Failed Stripe events, or a customer paid by card but the invoice is unpaid (ADR-0007, test mode) |
| [refunds](refunds.md) | Staff procedure for refunding an online card payment (ADR-0007); not an incident trigger |

## Conventions

- Surfaces: Developer Panel = `dev.*` host (console app); API paths under `/v1/dev/` (see `packages/contracts/openapi.json`). Needs a developer-role session; some actions need a fresh second factor (step-up).
- Process control on a dev machine: `scripts/svc.sh start|stop|restart api|worker|web|console|mobile`. Production topology: `infra/compose.prod.yml` (caddy, migrate, api, worker, web, console, postgres, valkey, clamav) behind `infra/caddy/Caddyfile`.
- Health first: `GET /v1/dev/health` (permission `diagnostics.read`) returns database latency and migrations, Redis, per-queue counts and oldest waiting age, live worker heartbeats with config versions, outbox pending count and age, and provider and SMS-route health.
- Every incident gets a written record (timeline, decisions, follow-ups). The platform audit log (`GET /v1/dev/audit-log`, hash chain verifiable at `/v1/dev/audit-log/verify`) holds the control changes; the incident record holds the reasoning.
- Alert recipients, on-call rota, status page and pager tooling are not defined in the booklet: UNKNOWN until Uni Travel decides (see `docs/stages/STAGE-0.md`). Where a runbook says "notify", it means the in-app DEVELOPERS or owner audience the platform already uses, plus whatever channel the owner sets.
- Customer wording: honest status only, never imply a booking or price is confirmed when it is not (booklet ch. 35.1 rule 3).

## Common first step (all runbooks)

1. Open the incident record with the time you noticed and the trigger.
2. `GET /v1/dev/health`. Note anything not `ok`.
3. Check recent control changes: `GET /v1/dev/audit-log` (config publishes, provider changes, route changes, flag changes). Roll back a bad config version through `POST /v1/dev/config/{domain}/versions/{version}/publish`.

# Runbook: supplier outage

Booklet ch. 30.7. Trigger: a flight provider circuit breaker has been OPEN for more than 15 minutes.

## Impact
Search degrades fail-soft (ch. 28.1 "Availability"): results come from the remaining providers, the leg cache and staff-entered options. Requests, quotes, bookings and the manual service are unaffected. Nothing fabricated is ever shown to fill the gap (ch. 35.1 rule 2).

## Mechanics (apps/api/src/modules/suppliers/suppliers.service.ts)
- Gateway per provider: concurrency semaphore (`limits.maxConcurrent`), rate limit (`limits.rps`), daily call budget (`limits.dailyBudget`, Redis key `budget:<provider>:<date>`), timeout (`limits.timeoutMs`).
- Circuit breaker: opens at 5 failures or 50% errors in 60 s; half-open probe every 30 s. State is CLOSED, OPEN or HALF_OPEN. A change emits the outbox event `provider.health_changed`.
- `searchable()` skips providers that are disabled, lack the capability, are shadowed, or have an OPEN circuit. Budget exhaustion returns `SUPPLIER_RATE_LIMITED`.
- Raw call records keep a redacted native payload for 14 days (ch. 28.6).

## First 15 minutes
1. `GET /v1/dev/providers` : `health.circuit`, `successRate`, `p50`, `p95`, `lastError`, `callsToday` per provider.
2. Distinguish: one provider OPEN (supplier-side or credentials) versus all (our network, DNS, egress).
3. `POST /v1/dev/providers/{id}/test` runs a harmless call and returns raw status, latency and error code.
4. Check `callsToday` against `limits.dailyBudget`: an exhausted budget looks like an outage but is a configuration limit.

## Diagnosis
| Signal | Likely cause |
|---|---|
| `lastError` auth or 401/403 | Credentials expired or revoked: rotate (`PUT /v1/dev/providers/{id}/credentials`, step-up required) |
| 429 or `SUPPLIER_RATE_LIMITED` | Our budget or supplier throttling: lower `rps`/`maxConcurrent` or raise `dailyBudget` if contract allows |
| Timeouts, high p95 | Supplier degradation: check supplier status page; do not raise `timeoutMs` blindly |
| All providers failing | Egress or DNS from the host; check `infra/compose.prod.yml` api/worker logs |

## Mitigation
- Leave the breaker alone while the supplier is down: it protects the supplier and our latency.
- If a provider is flapping and hurting latency, disable it: `PATCH /v1/dev/providers/{id}` with `enabled:false` (needs a fresh second factor; audited; version bumped; all processes reload).
- If a single provider is the only source for a lane, tell admins to use staff search and manual options for open requests.
- Adjust limits through `PATCH /v1/dev/providers/{id}` (`limits`), never by editing code.

## Recovery
Re-enable (`enabled:true`), run `/test`, watch the circuit move HALF_OPEN to CLOSED, then run the benchmark searches (THR to LON, TBZ to MAN, MHD to FRA, EVN to LON; ch. 32.4) from staff search and confirm gateway results appear.

## Comms
- Admins: in-app notice that search is degraded and manual options are the fallback.
- Customers: only if request turnaround is affected; use the SLA wording, not supplier names.
- Supplier: raise a ticket with the call IDs from the call records.

## Follow-up
Record outage length against the search SLOs (ch. 30.5); review `maxConcurrent`, `rps` and leg-cache hit rate (the load test showed capacity is bound by provider limits, see `docs/stages/STAGE-6.md`); add a regression fixture if the failure mode was new.

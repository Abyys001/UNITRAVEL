# Flight catalog and Apify pacer (ADR-0034)

Customers only ever see stored catalog data. Every 4 h the worker starts **one** Apify run under the Redis lock `catalog:refresh:lock`. The run is sized so the $5 Free-plan cycle lasts until `monthlyUsageCycle.endAt`. Nothing a customer or anonymous visitor does can start a run.

## Where to look
- **Console → Flight catalog.** The usage widget shows spent this cycle, the cycle end, projected spend, rows and runs per day, `costCorrection`, and the last and next tick. Red means the projection is above budget − safety. The coverage strip shows each route's slots by status (NEVER / FRESH / AGING / STALE / EMPTY / ERROR); slots in back-off or error are listed below it.
- **Ledger:** `select purpose, status, rows_billed, est_cost_usd, max_charge_usd, actual_cost_usd, started_at from provider_usage_ledger order by started_at desc limit 20;`

## Pause and resume
Console → Flight catalog → **Pause** or **Resume** (`catalog.manage`). While paused, customers still see the stored data with its "Updated X ago" age. The pacer also pauses on its own when:
- **The budget is used up.** It resumes when `cycleEnd` passes.
- **3 ticks fail in a row.** It resumes after 2 h.
- **Apify answers 401/403.** The credential is marked invalid. Fix the token in the Developer Panel, then press Resume.

## Admin spend (the $0.75 reserve)
- **"Refresh this slot now"** and **Revalidate** spend the reserve. Each one shows the estimated cost before you confirm, and both need step-up.
- **The reserve is released for refreshes in the last 12 h of the cycle**, because Apify credit does not roll over.

## Account hard cap
Developer Panel → Apify → **Apply account cap** (`provider.config.write` + step-up, audited).
- It sets Apify's account-wide `maxMonthlyUsageUsd` to the catalog budget, which also caps any other use of that Apify account.
- The owner must approve the first use.

## Weekly schema check
Runs are pinned to actor build `0.1.167`. Once a week the worker reads the actor's default build for free. It alerts admin (banner on the usage widget and Developer Panel) when:
- the build number changes, or
- `kayakWhenGoogleEmpty`, `fillMissingPricesFromKayak`, `resolveBookingOptions` or `resolveReturnFlights` is missing or renamed.

Upgrading means checking the new input schema, then changing `APIFY_ACTOR_BUILD` in `adapters/apify/client.ts` through code review.

## Live smoke (manual, never CI)
Run `pnpm tsx scripts/apify-smoke.ts --yes`.
- It sends 2 route-dates with `maxTotalChargeUsd=0.02`, at a cost of at most $0.02.
- It fails if any row came from KAYAK, or if the cost does not equal rows × $0.001 + $0.001.
- It refuses to run when `CI` is set.

## After a policy change
Snapshots are built when data is written. Changing a carrier or lane policy queues `catalog.snapshots.rebuild`, which costs nothing on Apify. Deployed hosts need the `FLIGHT:IR:*` lane policy set to **REVIEW** through the compliance policy screen. Without that row, results on Iran routes are shown without the review notice.

## After deploying migration 0022
1. Clear Valkey `perm:*` so admin and developer pick up `catalog.read` and `catalog.manage`.
2. Set `WEB_REVALIDATE_URL` and `WEB_REVALIDATE_SECRET` on the api and worker, and the same secret on web.

## Aviation Edge schedules (ADR-0036)
Aviation Edge adds **predicted schedules, without prices**, beside the priced source. It has its own pacer: every 4 h under `catalog:schedule:lock`, for DIRECT slots 7 to 60 days out, each slot refreshed every 72 h, one call per slot. COMBINED routes are built from the hub slots' schedules. Customers see these results as "Scheduled · not confirmed availability". A priced result for the same flights always wins.

### Turn it on
1. Developer Panel → Providers → **Aviation Edge** → **Replace key**. Enter the key (step-up). It is stored encrypted, and the panel only ever shows the last 4 characters. Do not put it in `.env`; there is no environment variable for it.
2. **Test connection.** This spends 1 call (IKA→IST, today + 8 days). A 401/403 marks the key invalid.
3. **Coverage probe.** This needs step-up and spends 10 calls: departures from IKA, IST, SAW, DXB, DOH, LHR, LGW, FRA, CDG and AMS on today + 8 days. Copy the result into `docs/stages/STAGE-27.md`.
4. Console → Flight catalog → Settings → **Aviation Edge schedules**. Set `aviationEdgeMonthlyCalls` to the plan's allowance (Developer 30k, Business 100k) and keep a reserve.
5. Developer Panel → Aviation Edge → **Enable**.

### Pauses
- **AUTH:** the key was rejected. Replace the key; the pacer resumes on the next tick.
- **RATE_LIMITED:** the plan's quota is used up. The tick stops.
- **CIRCUIT:** 3 failed ticks in a row.
- **BUDGET:** the monthly calls minus the reserve are used up.
- **DISABLED / NO_KEY:** self-explanatory.

Calls used: `select sum(credits) from provider_usage_ledger where provider = 'aviation-edge' and started_at >= date_trunc('month', now() at time zone 'utc');`

### When the subscription ends (terms §8.1)
Aviation Edge data may not be kept or used after the subscription ends.
1. Disable the provider.
2. Delete its data:
   ```sql
   delete from flight_schedules where provider = 'aviation-edge';
   update catalog_schedule_slots set payload = '[]', status = 'NEVER', version = version + 1 where provider = 'aviation-edge';
   ```
3. Flush the schedule cache: `valkey-cli --scan --pattern 'cat:sched:*' | xargs valkey-cli del`. Also clear `aviation-edge:coverage:last` and `catalog:schedule:state`.

## Flight Builder captures (ADR-0037)
- **Record an option.** Admin Panel, catalog, Flight Builder. The route (origin and destination) must already be a tracked DIRECT watchlist route, otherwise the API answers 422 `ROUTE_NOT_TRACKED`; a blocked carrier, airport or lane answers 422 `POLICY_BLOCKED`. The catalog slot row is created if missing; feed polling still follows the route's own horizon.
- **Feed refreshes never remove captures.** `writeSlot` retires only `capture='FEED'` rows. The slot snapshot is rebuilt from all current rows; when a STAFF and a FEED row have the same flights and local departure, the STAFF row is shown. STAFF rows never feed self-transfer combinations.
- **Freshness.** Job `flight-builder.freshness` (catalog queue, every 15 minutes) marks fares STALE (older than `staleHours`) or EXPIRED (ticketing date reached, 00:00 UTC), takes results with no LIVE fare out of the catalog and rebuilds the snapshots. No provider is called. Stale results are hidden from customers.
- **Retire.** `POST /v1/admin/flight-builder/options/:id/retire`; history stays.
- **Rollback.** Migration 0027 only adds. Set `flight_builder.enabled=false` and retire the STAFF rows.

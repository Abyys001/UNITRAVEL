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

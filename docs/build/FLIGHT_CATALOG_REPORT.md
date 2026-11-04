# Flight catalog and refresh pacer: build report (stage 24, 4 Nov 2026)

Sources:
- Decision record: ADR-0034.
- Plan: `docs/build/PLAN-flight-catalog.md`, approved by the owner on 4 Nov 2026.
- Spec: `docs/integrations/flight-catalog-refresh-spec.md`. The owner's brief overrides it where they differ.

Evidence labels follow CLAUDE.md rule 7.

**Status:** built and verified locally, including **one live Apify run**. Nothing is committed and nothing is deployed. Migration `0022_flight_catalog.sql` is left uncommitted, as the owner asked.

## 1. What was built

**Customers never trigger Apify.** The app calls Apify on its own schedule, stores the results in Postgres, and serves customers from customer-safe snapshots only, through Valkey and then Postgres. No customer or anonymous request can reach a provider. The old customer endpoint `POST /v1/flight-searches` and its GET/SSE routes are now staff-only, and prewarm is removed.

| Area | What changed |
|---|---|
| **Apify client** (`suppliers/adapters/apify/client.ts`) | **Cost controls on every run.** Every run sends `kayakWhenGoogleEmpty`, `fillMissingPricesFromKayak`, `resolveBookingOptions` and `resolveReturnFlights` as `false`, together with `exploreAnywhere:false` and `calendarDays:0`, whatever the caller passes. Before this change the actor defaulted `kayakWhenGoogleEmpty` to **true** and we never sent it (OBSERVED, F2).<br>**Pinning and caps.** Runs are pinned to `build=0.1.167`. Every run must carry `maxResults` and `maxTotalChargeUsd`.<br>**New calls.** `defaultBuild()` reads the input schema at no cost. `setMonthlyCap()` sets the account cap and is only ever triggered by the owner. |
| **Contracts** (`packages/contracts/src/catalog.ts`) | **Settings and defaults** for this build.<br>**Public allowlist shapes**: `PublicItinerary`/`Detail` have no field for an amount, currency, fare, baggage or provider.<br>**Search/routes responses** and **admin DTOs**.<br>**New permissions:** `catalog.read` (admin, developer) and `catalog.manage` (privileged; admin, developer). |
| **Pacer** (`packages/engine/src/pacer.ts`, pure functions) | **Tiers and back-off:** tiers, empty back-off (×2 up to ×8), and the error skip.<br>**`tickBudget`:** spends the cycle evenly over the ticks that remain. Admin spend comes out of the $0.75 reserve first, and the reserve is released in the last 12 h.<br>**`selectRun`:** one `maxResults` group per run, because `maxResults` is a run-level field. The cap is never higher than what is still available.<br>**Also:** `adminRunCap`, demand decay, the budget calculator, and `catalogEngineRules`. The owner's layover window can never loosen an airport, carrier or lane block. |
| **Database** (migration 0022) | **New tables:**<br>• `flight_watchlist_routes`: DIRECT or COMBINED. Seeded with IKA→IST (max 3), IST→LHR (max 5) and IKA→LHR (COMBINED via IST).<br>• `catalog_slots`.<br>• `flight_results`: unique on `slot + identity_key`; rows are marked `is_current` rather than deleted.<br>• `flight_result_legs`.<br>• `flight_result_pricing`: admin only, keeps the previous amount and the time it changed.<br>• `catalog_public_snapshots`.<br>• `provider_usage_ledger`: linked to `provider_runs`, with no purge.<br>**Changes:** `provider_runs` accepts `pool=catalog` and `purpose=CATALOG`. |
| **API** (`apps/api/src/modules/catalog/`) | **Settings** are stored in the `settings` row `catalog`; runtime state goes in `catalog.state`. Every change is audited.<br>**Queue `catalog` and its jobs:**<br>• `refresh.tick` every 4 h, plus a catch-up tick when the worker starts. The catch-up skips if a tick ran recently.<br>• `refresh.collect` every 15 s, with a 10-minute timeout.<br>• `slots.roll` daily, `demand.fold` hourly, `reconcile` at 03:00 UTC.<br>• `schema.check` weekly (Monday 04:00 UTC). It alerts if the build moves or any cost field disappears.<br>• `snapshots.rebuild` when a policy is activated.<br>**Lock:** `catalog:refresh:lock`.<br>**Failure handling** follows the spec's §9 matrix. A 401/403 marks the credential invalid and pauses the pacer. A failed run is retried once and opens a circuit after 3 failures. A partial run keeps what it got, and the missing slots stay due. An exhausted budget pauses the pacer until the cycle ends. |
| **Write path** | One transaction per slot, in this order:<br>1. normalise the rows;<br>2. drop rows on a carrier, airport or lane BLOCK, and flag rows on lane REVIEW;<br>3. upsert by identity and mark rows that are no longer listed;<br>4. record any price change;<br>5. bump the slot `version`;<br>6. rebuild self-transfer combinations with `joinAtHub`/`buildItinerary`, keeping the older leg's `fetchedAt`;<br>7. build the snapshot through the allowlist serializer;<br>8. after commit, publish `catalog.slot_updated`, which triggers web revalidation. |
| **Supplier registry** | For Apify, the dollar admin-reserve check replaces the call-count `dailyBudget`. Staff search records `admin_search` in the ledger. `FlightDataService.lookup` refuses any call without a staff context. |
| **Customer web** (`apps/web`) | **`/search`** is server-rendered and calls `GET /v1/flights/search` with `next.revalidate 300` and tag `catalog`. It handles five states: RESULTS, STALE, EMPTY (nearby dates and "Ask our team"), NOT_TRACKED, and UNAVAILABLE, which is the only state that shows the old NO_SOURCES message.<br>**On every result:** "Updated X ago", the party note, the self-transfer label with the layover and risk flags, and the Iran review notice.<br>**New pages and routes:**<br>• a detail page at `/[locale]/flights/results/[id]`;<br>• `POST /api/revalidate`, which checks a secret in constant time and returns 404 if the secret isn't set.<br>**Strings:** en and fa are in `packages/i18n` (`catalog.*`). |
| **Console** (`apps/console`) | **Admin › Flight catalog** has:<br>• a usage widget (spent, cycle end, projection, reserve, cost correction, last and next tick, paused and schema banners);<br>• a coverage strip per route, with slot results, indicative prices, and Revalidate / "Refresh this slot now" (quote, confirm, step-up);<br>• pause and resume;<br>• the watchlist editor;<br>• the settings and connection-rules editor, with a live budget calculator;<br>• the untracked-demand list.<br>**Developer Panel › Apify** adds "Test connection" and "Apply account cap" (type APPLY, then step-up).<br>`ApifyUsageTile` now reads the catalog usage. Strings are in en and fa. |
| **Docs** | **New:** ADR-0034, the runbook `docs/runbooks/flight-catalog.md` and `docs/stages/STAGE-24.md`.<br>**Updated:** two DPIA retention rows (demand-counter hashes kept 1 h; the cost ledger) and the OpenAPI document (280 paths, 18 new). |

## 2. Endpoints

| Method and path | Access |
|---|---|
| `GET /v1/flights/search?from&to&date&flex=0..3&cabin&adults` | public. ETag/304; `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=900` |
| `GET /v1/flights/results/:id` | public (no prices) |
| `GET /v1/flights/routes` | public (cached 1 h) |
| `GET /v1/admin/catalog/usage`, `/coverage`, `/settings`, `/routes`, `/slots/:id/results`, `/jobs/:jobId`; `POST /estimate` | `catalog.read` |
| `PATCH /v1/admin/catalog/settings`; `POST/PATCH /routes`; `POST /pause`, `/resume`, `/slots/:id/refresh/quote` | `catalog.manage` |
| `POST /v1/admin/catalog/slots/:id/refresh`, `/results/:id/revalidate` | `catalog.manage` + step-up (admin reserve) |
| `POST /v1/admin/itineraries/:id/recheck` | also accepts a catalog result id (`catalog.manage` + step-up) |
| `POST /v1/admin/integrations/apify/test` | `provider.config.read` |
| `POST /v1/admin/integrations/apify/apply-cap` | `provider.config.write` + step-up, audited. **Never called.** |
| `POST /v1/flight-searches`, `GET …/:id`, `…/events` | now staff only |

## 3. Settings in force (owner brief and approval, 4 Nov 2026)

| Setting | Value |
|---|---|
| Budget | $5.00 per cycle, safety $0.20, admin reserve $0.75 (released in the last 12 h) |
| Ticks | 6 a day (every 4 h), plus a catch-up tick at worker start; at most 40 slots per run |
| Results per run | default 3, `best` order, one-way, 1 adult, economy, USD, market GB<br>IKA→IST 3, IST→LHR 5 |
| Tier targets | 0–2 days every **8 h**, 3–7 days every 24 h, 8–14 days every 72 h |
| Freshness rules | floor 4 h; slots hidden after 7 days; empty back-off after 2 empty results, ×2 per step up to ×8; error skip 24 h after 3 errors |
| Connections | hubs IST on, SAW off; layover 4–6 h (min and max editable); same airport; overnight off; day offsets 0/+1; pair IKA→IST→LHR stored as IKA→LHR |
| Budget calculator | about $4.1 a month if every refresh came back full, against $4.05 spendable. The pacer stretches intervals when real results are fuller than expected. |

## 4. Verification

**Typecheck:** contracts, engine, domain, db, i18n, api, web and console are all clean. The repo has no eslint config, so the typecheck serves as lint.

**Unit tests:**

| Suite | Result | Notes |
|---|---|---|
| engine | 31/31 | The 30-day cycle simulation (fast-check, 25 seeds, random results, empty routes, admin spend, 8% failed runs) shows that spend stays ≤ budget − safety, the reserve is untouched until the release window, the 4 h floor is never broken, and the 0–2-day tier stays within 3× its target when the budget allows. |
| contracts | 24/24 | |
| api unit | 201/201 | |
| domain | 138/139 | The one failure is the known `name-matcher` property test (ADR-0013 record). This change doesn't touch it. |

**API e2e for the catalog:** 71/71, on real Postgres and Valkey.
- `catalog.e2e.ts` 25: every public endpoint in every state, with the Apify client and `SuppliersService.search` as spies that fail the test if called; ETag/304; the price leak check on endpoints and snapshots; permissions.
- `catalog-pacer.e2e.ts` 33: the run input, the lock, the failure matrix, reconcile, the schema check and the budget arithmetic.
- `catalog-write.e2e.ts` 13: upsert, rows no longer listed, price change, carrier and lane exclusion, the REVIEW flag, connections, and snapshot version bumps.

**Other e2e files:**
- **Run one file at a time**, they pass: matrix 25/25 and stage3 8/8, plus every other file except the three below.
- **`phase-j` 28/29:** a sign-in counter on a shared user reads 2 instead of 1.
- **`hardening` 9/10:** a leftover phone row in the shared dev database.
- **`services` 8/9:** the `club` flag is off.
- **`visa` 2/12:** `services.visa.enabled` was left `false` by another suite's teardown.
- **Run as one suite**, more files fail on sign-in rate limits (OTP/TOTP 429s) and feature-flag state that suites leave behind for each other in the shared process. Excluding the catalog files produces the same failures, so they are not caused by this change. UNKNOWN whether they predate this session.

**Load:** `infra/load/search.k6.js` has a `GET /v1/flights/search` scenario with a p95 < 100 ms threshold. k6 isn't installed here, so it has not been run. In-process measurements: p95 4.7 ms sequential and 22 ms at 20 concurrent requests.

**Live run (OBSERVED, 4 Nov 2026 13:28 UTC):** the owner supplied the Apify token. It was imported once from `.env` into the encrypted credential store (logged as last 4 only), then removed from `.env`. The worker's catch-up tick started one run.
- The run used build `0.1.167`, `maxResults` 5, 5 IST→LHR route-dates and `maxTotalChargeUsd` 0.03.
- Apify's stored `INPUT` shows all four cost fields as `false`.
- It returned 25 `flight` rows and 1 free `notice` row. No row came from KAYAK.
- `usageTotalUsd` was **$0.025**, matching 25 rows × $0.001. No start fee was charged.
- `GET /v1/flights/search?from=IST&to=LON` returned RESULTS from that data, with no price-like keys.

**Account limits (OBSERVED):** the cycle runs from 2 Nov 00:00 to 1 Dec 23:59:59 UTC. **The account hard cap is currently $6.00**, with $0.11 used before this run.

## 5. How to test

1. **Start the stack:** `docker compose --env-file .env -f infra/compose.dev.yml up -d`, then `pnpm db:migrate && pnpm db:seed`, then `scripts/svc.sh start api worker web console`.
2. **Unit tests:** `cd packages/engine && npx vitest run src/pacer.spec.ts`, and `cd apps/api && npx vitest run --project unit`.
3. **Catalog e2e:** `cd apps/api && npx vitest run --project e2e test/catalog.e2e.ts test/catalog-pacer.e2e.ts test/catalog-write.e2e.ts`. While they run, the tests switch the real routes off, and they delete only rows that touched test slots.
4. **Customer pages:** open `http://localhost:4000/en/search?from=IST&to=LON&date=<date in the next 14 days>`, and the same with `from=THR&to=LON` to see the empty state.
5. **Admin pages:** console → Admin › Flight catalog. For the account cap, see the Developer Panel › Apify page.
6. **Live smoke (manual, costs at most $0.02):** `pnpm tsx scripts/apify-smoke.ts --yes`. It refuses to run under `CI`.
7. **Load:** `k6 run infra/load/search.k6.js`.

## 6. Known gaps and open items

1. **Account cap:** the Apify account cap is $6.00, not $5.00. "Apply account cap" has never been called; the owner decides.
2. **Iran lane policy on deployed hosts:** they need the `FLIGHT:IR:*` lane policy set to REVIEW through the compliance policy screen. Locally it is seeded. If the row is missing, Iran results show without the review notice, and the coverage view shows `NO_IR_LANE_POLICY`.
3. **IKA→LHR combinations:** none exist yet. IKA→IST has no live data so far; the next scheduled tick runs the 3-result group. With 3 rows per leg and a 4–6 h window, many dates may have no pairing. Customers then see the empty state with "Ask our team", which is intended.
4. **Mobile app:** the Flutter app (`search_screen.dart`, `repos.dart`) still calls the now staff-only `POST /v1/flight-searches` as a customer. Mobile is paused under ADR-0026.
5. **Popular-flight cards** on `/flights` now read the catalog. Catalog rows have no stored search, so `offerRef` is null and segments are absent. The card still works: it requests through the manual flow, pre-filled with route and date. It does not link to the result detail page, because `FlightListingItem` has no catalog result id. Adding one would be an additive change to the contract and the API.
5a. **Playwright (web and console) has not been run** because the servers were down. The changed specs pass typecheck only:
   - `live-data`, rewritten read-only against the real API;
   - `adr0032-fullstack`, whose prewarm-dependent test was removed;
   - `visual`;
   - `popular-flights`, with a new test for a catalog-style card;
   - the console's `adr0032-apify`.

   The `search-results-*` screenshot baselines need to be regenerated. `visual-capture.spec.ts` still picks cards from `/search?q=`, so re-recording the cassette would fail.
6. **Cross-process behaviour:** the scheduler, lock and queue across separate API and worker processes have been observed for a single tick only. The e2e tests call the services directly.
7. **Alert audience:** schema and auth alerts reach developers (`diagnostics.read`) through `provider.health_changed`, not admins.
8. **Web revalidation** needs `WEB_REVALIDATE_URL` and `WEB_REVALIDATE_SECRET` on the api and worker, and the secret on web. Until then, pages refresh on their 300 s revalidate.
9. **After deploy,** clear Valkey `perm:*` so admin and developer pick up `catalog.read` and `catalog.manage`.
10. **Token in chat:** the token was pasted into the session transcript. Rotate it on Apify, then enter the new one in Developer Panel › Apify.
11. **Test leftovers cleaned up:** the first catalog e2e runs wrote fake rows into the real slots in the shared dev database. They were removed (19 rows), and the harness was fixed. A later policy-rebuild test also deleted 14 real IST→LHR rows; they return with the next refresh.

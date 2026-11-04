# Plan: flight catalog and refresh pacer (proposed stage 24)

Status: **DRAFT v2, awaiting owner approval. No code until approved.**
Sources:
- "Flight Catalog & Refresh Pacer — Spec for Claude Code" (owner, 2026-11-04).
- The owner's build brief of the same day. Its settings override the spec defaults (§1 below).

Written 2026-11-04. Evidence labels per CLAUDE.md rule 7.

## 0. Findings that change the spec

| # | Finding | Label |
|---|---|---|
| F1 | `claude/flight-catalog-refresh-spec.md`, `claude/parallel-build-contract.md` and `claude/apify-google-flights-reference.md` are not in the repo. The claude.ai Project docs can't be reached from this session. I am working from the pasted spec and brief, ADR-0029/0031/0032 and `docs/build/PLAN-flights-request-invoice.md`. | BLOCKED (project docs) / OBSERVED |
| F2 | **Live cost bug on `main`.** The actor input field `kayakWhenGoogleEmpty` defaults to **`true`**. `adapters/apify/client.ts:14` says KAYAK is off by default and never sends the field. So any run that comes back empty from Google can start a KAYAK run, billed by a separate actor. IKA→IST is expected to be empty often, which makes this worse. | OBSERVED (public actor input schema, build 0.1.167, built 2026-11-04 07:55 UTC, read token-free, no run started) |
| F3 | `maxResults` is a single run-level field. A run cannot use a different value per route. | OBSERVED (schema) |
| F4 | The actor was rebuilt today, so its defaults can drift. Plan: pin `build=0.1.167` on the run URL, and run a free daily check of `GET /v2/acts/{actor}/builds/default` that pauses refreshes if a field we rely on disappears or changes its default. | OBSERVED / proposed |
| F5 | The tables `flight_watchlist_routes`, `flight_results`, `flight_result_pricing` and `provider_usage_ledger` don't exist yet. What does exist: `provider_runs` (the Apify run log), a Redis ledger at `apify:ledger:{YYYY-MM}:{pool}`, `settings` (key/jsonb) and `listings.flightRoutes`. | OBSERVED |
| F6 | **Customers can trigger paid Apify runs today.** The customer `/search` page posts to `POST /v1/flight-searches`. When that misses the cache, `FlightDataService.lookup()` starts a paid run. | OBSERVED |
| F7 | The API is mounted under `/v1/...`, not `/api/...`. The self-transfer joiner already exists: `joinAtHub()` and `buildItinerary()` in `packages/engine/src/build.ts`. It has min/max layover, an overnight window and `allowOvernight` (lines 53–55). The risk keys `risk.SEPARATE_TICKETS`, `OVERNIGHT` and `TIGHT` exist in `packages/i18n/src/en.ts:57`. | OBSERVED |
| F8 | IKA→IST is an Iran lane. ADR-0031: the lane is REVIEW, so results are shown with the "our team reviews trips to or from Iran" notice (I5); Iranian carriers are always hidden (BLOCK); a request goes to `COMPLIANCE_HOLD`. Combined IKA→LHR itineraries inherit the REVIEW flag. | DOCUMENTED (ADR-0031 I3, I5) |
| F9 | **The brief's tiers cost more than the budget allows, at most.** Each route has 14 days on the horizon:<br>• days 0–2: 3 dates × 6 refreshes a day = 18<br>• days 3–7: 5 dates × 1 a day = 5<br>• days 8–14: 7 dates every 3 days ≈ 2.33<br>That is about 25.3 slot refreshes per route per day, or about 50.7 a day for 2 routes. Each refresh returns at most 3 rows, so the worst case is about $0.152 a day in rows, plus about $0.006 a day for 6 run starts. Over 30 days that is **≈ $4.74, against $4.05 the pacer may spend** ($5.00 − $0.20 safety margin − $0.75 reserve). In a month when every slot returns 3 rows, the pacer stretches the 0–2-day tier to roughly every 5 h. Empty IKA→IST rows are free, so a real month should fit. | INFERRED (arithmetic) |
| F10 | With only 3 rows per leg ("best" order) and a 4–6 h layover window, a given date may have no valid IKA→IST→LHR pairing. The customer then sees the empty state, as the brief requires. | INFERRED |
| F11 | Migrations are committed in `packages/db/migrations/` (latest is `0021_apify_google_flights.sql`). The brief says not to commit generated migrations, and CLAUDE.md says never to commit unless asked. I will generate the migration and leave it uncommitted. | OBSERVED |

### Actor input fields (spec §1.3, §12), verbatim from the input schema

The Apify MCP isn't connected in this session. I read the actor's public build endpoint without a token and without starting a run.

| Purpose | Field | Actor default | We send |
|---|---|---|---|
| KAYAK when Google returns nothing | `kayakWhenGoogleEmpty` | **true** | `false` |
| Fill missing prices from KAYAK | `fillMissingPricesFromKayak` | false | `false` |
| Booking options | `resolveBookingOptions` | false | `false` |
| Return flights | `resolveReturnFlights` | false | `false` |
| Explore mode | `exploreAnywhere` | false | `false` |
| Price calendar | `calendarDays` | 0 | `0` |
| Price insights | `includePriceInsights` | true | `true` |
| Search summary row | `includeSearchSummary` | false | `false` |
| Run summary row (free, `type:"notice"`) | `includeRunSummary` | true | `true` (used by reconcile) |
| Batch routes | `routes[] {origin,destination,departureDate,returnDate?}` | none | one item per slot, no `returnDate` |
| Other fields | `maxResults`, `sortBy`, `currency`, `market`, `adults`, `cabinClass`, `maxStops`, `dataSource` | 100, `best`, USD, none, 1, economy, any, `auto` | `3`, `best`, `USD`, `GB`, `1`, `economy`, any, `auto` |
| Charge cap | `maxTotalChargeUsd` | none | query param on `POST /v2/acts/lergassy~google-flights-scraper/runs?build=0.1.167`, set to `ceil(estimate × 1.15)` to 3 decimal places |

The token is read from Integrations (`provider="apify"`, encrypted), falling back to `APIFY_TOKEN`. It is sent only in `Authorization: Bearer`. It never appears in logs, job payloads, fixtures or anything sent to the browser.

## 1. Settings for this build (stored in the `settings` row `catalog`, Zod `CatalogSettings`)

| Key | Value |
|---|---|
| `refresh_ticks_per_day` | 6 (every 4 h), plus one catch-up tick at worker start-up. The catch-up still respects the lock and the 4 h floor. |
| `monthly_budget_usd` / `safety_margin_usd` / `admin_reserve_usd` / `release_reserve_hours` | 5.00 / 0.20 / 0.75 / 12 |
| `default_max_results`, `sort_by` | 3, `best` |
| Trip, party, cabin | one-way, 1 adult, economy |
| `currency`, `market` | `USD`, `GB` (both editable) |
| Tiers (target intervals) | days 0–2: 4 h · days 3–7: 24 h · days 8–14: 72 h |
| `min_refresh_interval_hours` | 4 |
| Empty back-off | after 2 empty results in a row, the interval doubles each time, up to ×8. The next non-empty result resets it. |
| `hide_after_days` | 7 |
| Watchlist seed | `IKA→IST`, `IST→LHR`, `horizon_days` 14 each. Admin can edit. The popular-route cards keep reading `listings.flightRoutes`; the catalog doesn't replace them. |
| `connections` | `hubs: [{iata:"IST", enabled:true}, {iata:"SAW", enabled:false}]`, `min_layover_min: 240`, `max_layover_min: 360`, `same_airport: true`, `allow_overnight: false`, `day_offsets: [0, 1]`, `pairs: [{from:"IKA", via:"IST", to:"LHR"}]` |

## 2. Mapping the spec onto the repo

| Spec | Repo |
|---|---|
| Stream A `modules/flights` | New `apps/api/src/modules/catalog/` (CatalogModule: `catalog-refresh.service`, `catalog-write.service`, `catalog-connections.service`, `catalog-read.controller`, `catalog-admin.controller`). It reuses `adapters/apify/client.ts` and the normaliser in `apify/`. |
| Pacer maths | Pure functions in `packages/engine/src/pacer.ts`, with no framework imports: tiers, `tickBudget`, `selectSlots`, back-off, demand decay, reserve release. |
| Connection rules | Pure `catalogRuleResolver(settings.connections)` in `packages/engine`, which feeds the existing `joinAtHub()`/`buildItinerary()`. No second joiner. |
| Contracts | `packages/contracts/src/catalog.ts`: `CatalogSettings`, `PublicItinerary` (an allowlist of fields with no price), `CatalogSearchResponse`, `CatalogResultDetail`, admin DTOs. |
| Tables | `packages/db/src/schema/catalog.ts`. The fields marked * are new compared with the spec.<br>• `flight_watchlist_routes`<br>• `catalog_slots` (route, date, tier, `next_due_at`, `empty_streak`, `version`, `last_success_at`, `kind: direct\|combined`)<br>• `flight_results`, with `compliance_review`* and `is_self_transfer`*<br>• `flight_result_legs`*, which links a combined result to its two leg results<br>• `flight_result_pricing` (price history, admin-only)<br>• `catalog_public_snapshots`<br>• `provider_usage_ledger` (one row per run: purpose `refresh\|admin_revalidate\|admin_search\|smoke`, `run_id` → `provider_runs`, slot ids, estimated and actual cost, rows billed) |
| Migration | `packages/db/migrations/0022_flight_catalog.sql`, generated and left uncommitted (F11). It seeds the settings defaults and the two watchlist routes. |
| Queue and jobs | New queue **`catalog`** in `core/queues.ts`, registered through the `WorkerRegistry`. It needs its own queue because `maintenance` runs one job at a time and must not be blocked by a 10-minute run poll. Jobs:<br>• `catalog.refresh.tick`: `upsertJobScheduler`, every 4 h, plus one at boot<br>• `catalog.refresh.collect`: re-enqueued every 15 s while a run is live<br>• `catalog.connections.build`: after a feeder slot updates<br>• `catalog.slots.roll`: daily<br>• `catalog.demand.fold`: hourly<br>• `catalog.reconcile`: 03:00 UTC; replaces `flights-apify-reconcile-daily`<br>• `catalog.schema.check`: daily (F4)<br>• `catalog.snapshots.rebuild`: on a policy change, no Apify cost |
| Lock | `catalog:refresh:lock`, inline `SET NX PX`. TTL 15 min, renewed by each collect. Admin "refresh now" takes the same lock. |
| `GET /api/flights/search` | `GET /v1/flights/search?from&to&date&flex=0..3` (`@Public`). The web app calls the API origin directly, as all its other API calls do. If you need the literal `/api/flights/search`, say so. |
| Detail | `GET /v1/flights/results/:id` (`@Public`, no prices) |
| Routes list | `GET /v1/flights/routes` (`@Public`) |
| Admin revalidate | Extends `POST /v1/admin/itineraries/:id/recheck` to accept catalog result ids. It charges the admin reserve, writes the result back to the slot and bumps the slot version. |
| Admin catalog APIs | • `GET/PATCH /v1/admin/catalog/settings`, with a budget calculator preview in the response<br>• `GET /v1/admin/catalog/coverage`<br>• `GET /v1/admin/catalog/usage`<br>• `POST /v1/admin/catalog/slots/:id/refresh` (returns a cost quote first, then needs a confirmation token)<br>• `POST /v1/admin/catalog/pause\|resume`<br>• `GET/POST/PATCH /v1/admin/catalog/routes`<br>• `POST /v1/admin/integrations/apify/test` (`GET /users/me/limits`)<br>• `POST /v1/admin/integrations/apify/apply-cap`<br>New permissions: `catalog.read` and `catalog.manage`. Spend actions and the cap also require step-up. |
| Supplier registry | Apify stays a registered adapter for staff search and revalidation only. For Apify, the call-count `dailyBudget` (`suppliers.service.ts:221`) is replaced by the dollar pacer's admin-reserve check. Duffel, Amadeus and Fake keep the call-count budget. |

### Self-transfer connections (Tehran → Istanbul → London)

- **When they're built:** every time an `IKA→IST` slot for date D, or an `IST→LHR` slot for D or D+1, is written, `catalog.connections.build` recomputes the combined slot `IKA→LHR` for D.
- **How they're built:** `joinAtHub()` with the catalog rule resolver, which enforces:
  - the same airport (IST↔IST only, unless SAW is enabled);
  - a layover of 4–6 h;
  - no overnight layovers by default;
  - departure-day offsets of 0 or +1.
- **What's stored:** a combined `flight_results` row with `is_self_transfer=true`, two `flight_result_legs` rows, and a public snapshot for the combined slot. Building them costs nothing on Apify.
- **Freshness:** "Updated X ago" uses the older of the two legs. If either leg's row is no longer listed, the combination is dropped.
- **Labels for customers and admin:** `risk.SEPARATE_TICKETS` ("Separate tickets · self-transfer"), the layover duration, plus `OVERNIGHT` and `TIGHT` where they apply. Because of the IKA leg, the ADR-0031 Iran review notice is shown too.
- **Prices:** the admin-only price is the sum of the two legs, from `flight_result_pricing`. It is never in a snapshot.
- **Search:** a customer search for THR/IKA → LON/LHR resolves through the existing `/v1/locations` city codes to the combined slot. If there are no combinations, the customer sees the empty state with nearby dates and the "Ask our team" request form, never an error.

### What happens to the old fan-out

- **Kept for staff:** `POST/GET /v1/admin/flight-searches`, `SearchService`, waves and `suppliers.search`.
- **Retired from the customer path:**
  - `POST /v1/flight-searches`, `GET /v1/flight-searches/:id` and `/events` become staff-only (`@RequirePermission`).
  - `FlightDataService.lookup()` throws unless called with a staff actor. A guard and a test cover this.
  - Prewarm (ADR-0032 B3, the `listings-warm-flights` scheduler) is removed; the pacer replaces it.
- **Customer page:** `/search` switches from POST + SSE + polling to `GET /v1/flights/search`.
- **The old `NO_SOURCES` message:** shown only when the catalog itself can't be read, meaning Redis and Postgres both failed.

## 3. ADR first (rule 10)

Write **ADR-0034 "Flight catalog and dollar pacer"** before any code. It supersedes:
- ADR-0029 A6: the customer on-demand cache, the 40/30/30 pools and the hourly customer cap.
- ADR-0032 B3: prewarm.

It also records:
- that customer search reads only the catalog;
- the `kayakWhenGoogleEmpty` correction (F2);
- the build pin (F4);
- that write-time self-transfer combination is allowed;
- that ADR-0029's indicative and UNKNOWN rules still apply: baggage and conditions stay UNKNOWN, prices are staff-only, and cached data is never shown as guaranteed availability.

Add stage 24 to `docs/PLAN.md` (rule 9).

## 4. Build order (vertical slices, contracts and tests first)

0. **KAYAK hotfix.** Send all four KAYAK and resolution fields as `false` in `client.ts`, correct the comment and add a unit test. This lands first and on its own.
1. **Contracts and pure engine.**
   - `catalog.ts` contracts, `pacer.ts` and `catalogRuleResolver`.
   - Tests: the 30-day cycle simulation and connection-rule unit tests.
   - The simulation must show:
     - total spend ≤ budget − safety margin;
     - the reserve untouched until the last 12 h;
     - no slot refreshed inside the 4 h floor;
     - back-off at ×2 up to ×8.
2. **Schema and migration** (the 0022 migration and its seed).
3. **Write path.** One transaction per slot, in this order:
   1. normalise;
   2. carrier BLOCK and lane BLOCK drop rows; lane REVIEW flags them;
   3. identity upsert, and set `is_current=false` on rows no longer listed;
   4. record price changes in `flight_result_pricing`;
   5. bump the slot `version`;
   6. build the allowlisted snapshot into `catalog_public_snapshots` and Redis (`cat:{slot}:v{n}`, `cat:{slot}:latest`);
   7. after commit, emit the outbox event `catalog.slot_updated`, which triggers connection building and web revalidation.

   Rows are matched to slots by the route echoed on each row. If a dataset comes back partial, the slots it doesn't cover stay due.
4. **Pacer and runner.**
   - **Tick:**
     1. take the lock;
     2. read the cycle from `/users/me/limits` (`monthlyUsageCycle.endAt` and usage), cached for 10 minutes; if that call fails, fall back to the ledger × `cost_correction`;
     3. compute spendable = (budget − safety − reserve unless released − spent) × (hours to this tick ÷ hours left in the cycle);
     4. rank slots by how overdue they are × demand;
     5. send one run with `maxResults` and `maxTotalChargeUsd`;
     6. write a ledger row.
   - **Collect:** poll the run, then pass the dataset to the write path.
   - **Failure handling:**
     - the failure matrix from the spec;
     - a circuit breaker that pauses for 2 h after 3 failed ticks;
     - a 401 or 403 marks the credential invalid.
   - **Daily reconcile:** compare our ledger with Apify's reported usage and adjust `cost_correction`.
5. **Read path.**
   - **Lookup order:** Redis, then the snapshot table, then repopulate Redis. It never reads `flight_results` or pricing.
   - **HTTP caching:** `ETag "<slot>-<version>"` with 304 responses, and `Cache-Control` as in spec §6.3.
   - **Results:** grouped by `flex`, using the spec's states: fresh, stale, empty, not tracked, catalog unavailable.
   - **"Updated X ago"** appears on every result.
   - **Demand counter:** +1 per view, deduped per visitor per hour using `sha256(ip + ua + daily salt)`. Only the hash goes into Redis, with a 1 h TTL, and the DPIA gets a note. A submitted request adds +5.
6. **Console (admin and Developer Panel).**
   - **Usage widget:** spent this cycle, cycle end, projected spend, `cost_correction`, last and next tick, and a paused banner.
   - **Per route:** a coverage strip.
   - **Controls:** pause/resume, and "refresh this slot now" (shows the reserve cost and asks for confirmation).
   - **Editors:** the watchlist, plus settings and connection rules with a live budget calculator that also shows the F9 maths.
   - **Developer Panel:**
     - Apify token entry (write-only) and "Test connection";
     - an "Apply account cap" button (`PUT /v2/users/me/limits` `{maxMonthlyUsageUsd: 5}`). I will ask you before anyone calls it the first time.
   - en/fa strings.
7. **Customer web (`apps/web`).**
   - `/search` becomes a server-rendered page that fetches with `fetch(..., {next: {revalidate: 300, tags: ['slot:<id>']}})`.
   - New route handler `app/api/revalidate/route.ts`. It checks `WEB_REVALIDATE_SECRET` (env only) with a constant-time compare. The API calls it on `catalog.slot_updated`.
   - Detail page. "Updated X ago", the "may have changed" notice and the self-transfer or Iran-review labels, all in en/fa (RTL).
8. **Tests.**
   - **e2e:**
     - every public flights endpoint in every state;
     - `ApifyClient` replaced by a spy that fails the test if it's called;
     - `SuppliersService.search` also spied.
   - **Write path:**
     - upsert;
     - rows no longer listed;
     - price change;
     - policy exclusion;
     - connection building, including the offset, overnight and layover-window edge cases;
     - snapshot and version bump.
   - **Price-leak contract:** extended to the new endpoints and snapshots.
   - **Permissions:** the permission matrix and the fail-closed route table updated.
   - **Load:** `infra/load/search.k6.js` gets a `GET /v1/flights/search` scenario with a p95 < 100 ms threshold.
   - **Live smoke:** `scripts/apify-smoke.ts`, run by hand only.
     - It sends 2 route-dates with `maxTotalChargeUsd=0.02`.
     - It checks that no row has `dataSource:"kayak"` and that cost = rows × 0.001 + 0.001.
     - It refuses to run if `CI` is set.
   - **CI** never reaches Apify: the client throws when `NODE_ENV=test` unless a mock base URL is injected.
   - **Last:** run lint, typecheck and all tests.
9. **Docs.**
   - `docs/build/FLIGHT_CATALOG_REPORT.md`: what was built, endpoints, settings, how to test, known gaps.
   - `docs/stages/STAGE-24.md`.
   - `docs/runbooks/flight-catalog.md`: pause, cap and smoke.
   - The DPIA line about the demand-counter hashes.
   - The OpenAPI document, updated in the same change.

## 5. Open questions for the owner

1. **`provider_usage_ledger` vs `provider_runs`.** You listed `provider_usage_ledger`, so I'll add it as a cost ledger linked to the existing `provider_runs` run log. The alternative is to add the four cost columns to `provider_runs` and have no new table. Is the new table OK?
2. **Rows for the feeder legs.** With 3 rows per leg, IKA→IST→LHR combinations may be rare (F10). Keep 3, or let the two feeder routes use 5? 5 costs about 1.6× as much and makes F9 tighter.
3. **Iran lane on customer pages.** Under ADR-0031, IKA→IST and the combined IKA→LHR results are shown with the review notice, and requests go to `COMPLIANCE_HOLD`. Can you confirm the `IR:*` lane is currently set to REVIEW, not BLOCK, in the policy data? If it's BLOCK, customers will see nothing for these routes.
4. **Path.** Is `/v1/flights/search` acceptable, or do you need the literal `/api/flights/search`?
5. **Build pin.** Pin build `0.1.167` and upgrade deliberately after the schema check (my recommendation), or always use the latest build?

## 6. Risks

- **Spend near the limit.** The design spends close to the budget, and F9 shows the worst case is 17% over. The guards are the simulation test, `maxTotalChargeUsd` on every run, and the account cap.
- **Shared Apify account.** `/users/me/limits` reports usage for the whole account, so any other use of the account shrinks the catalog budget. That is safe, and the coverage view shows the reason.
- **Stale snapshots.** Snapshots are built when data is written. Any change to the serializer or to a policy needs `catalog.snapshots.rebuild`, which is part of slice 4.

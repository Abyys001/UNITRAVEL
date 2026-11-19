# STAGE-27 · Aviation Edge schedule source (ADR-0036)

Owner brief of 10 Nov 2026: integrate Aviation Edge as an additional flight data provider. The API key is entered in Settings (Developer Panel), never in `.env`, and the provider has enable/disable, a connection test, and multiple providers side by side. Built on 10 Nov 2026. Not committed, not deployed.

## What was built
- **Contracts.** `ProviderId` gains `aviation-edge`. `PublicItinerary.basis` is `OFFER` or `SCHEDULE`, and old snapshots read as OFFER. Five `aviationEdge*` catalog settings were added, plus `DevAviationEdgeTestResult`, `DevAviationEdgeCoverage` and `DevAviationEdgeStatus`.
- **DB (migration 0025).** New tables `catalog_schedule_slots` and `flight_schedules`. The provider rows `aviation-edge` and `flightapi` are disabled and have every capability false.
- **API.**
  - The client and normaliser are in `apps/api/src/modules/suppliers/adapters/aviation-edge/`.
  - `AviationEdgeService` covers the key, budget, test, coverage and status.
  - `ScheduleWriteService` writes schedules, with compliance filtering, the allowlisted snapshot and schedule self-transfers.
  - `ScheduleRefreshService` runs the job `catalog.schedule.tick` every 4 h under the lock `catalog:schedule:lock`, with a catch-up tick at worker boot.
  - Schedules and offers are merged and deduped on read in `CatalogReadService`, and `results/:id` resolves schedule rows.
  - `packages/engine` has the pure slot selection and budget arithmetic (`schedule-pacer.ts`), plus `segmentsVerdict`. `filterOffers` behaviour is unchanged.
- **Routes.** All three are under `/v1/dev/providers/aviation-edge`: `POST test` (`provider.config.write`), `POST coverage` (`provider.config.write` + step-up) and `GET status` (`provider.config.read`). The generic `:id/test` answers 400 "use the provider page" for `aviation-edge` and `flightapi`.
- **FlightAPI.** The key can be entered in the panel and the panel key wins. `FLIGHTAPI_KEY` is imported once when nothing is stored, and is still read as a fallback.
- **Console.**
  - New Developer Panel page `/providers/aviation-edge` with these sections: key (last 4 only), enable/disable, test, status and budget, capabilities, coverage probe and audit.
  - The providers list links to the page and shows a FlightAPI note.
  - The catalog settings have an "Aviation Edge schedules" group.
  - Staff slot results show a "Schedule" chip and "Price: not available from this source".
- **Web.**
  - SCHEDULE results show the badge "Scheduled · not confirmed availability" in en and fa, with an explanation.
  - Leg detail shows "Not provided" for a missing terminal or aircraft.
  - The search form and request flow are unchanged.

## Verification (10 Nov 2026)
| Check | Result |
|---|---|
| `turbo run typecheck` (14 tasks incl. api, web, console) | passed |
| API unit (`apps/api`, vitest unit project) | 36 files, 260 tests passed |
| Engine unit | 44 passed |
| `catalog-aviation-edge.e2e.ts` (21 tests: encrypted and masked key, test plus 401 invalidation and recovery, disabled provider does nothing and keeps the key, tick writes schedules plus ledger credits, 429 stops, circuit, dedupe against a priced row, schedule self-transfer, public search `basis: SCHEDULE` with no price fields, `results/:id`, W5 dropped by policy, sentinel-key leak sweep) | 21/21, re-run independently 21/21 |
| `catalog.e2e`, `catalog-write.e2e`, `catalog-pacer.e2e`, `catalog-flightapi.e2e`, `matrix.e2e` | passed. One `catalog.e2e` "usage" failure straight after the worker restart passed on re-run (25/25). INFERRED cause: the boot tick wrote a ledger row |
| AE client and normaliser units, catalog-model price-leak (now covering schedule payloads) | 34/34 in an independent re-run |
| `i18n` package | 22 passed |
| Console page `/providers/aviation-edge` in a browser (signed in, dev host) | Renders all sections. Fixed a link to `/catalog` that 404'd on the dev host: it is now text naming the Admin Panel location |
| `openapi.json` regenerated | New routes and schemas. The diff also carries drift from before this change (`service_catalog.manage`, some `BAGGAGE` enum entries) |

All Aviation Edge calls in tests are mocked: the client refuses the production host under `NODE_ENV=test`. **No live Aviation Edge call has been made.**

## Requires a real key (UNKNOWN until run)
- Live authentication, and the real error bodies for a bad key, no subscription and an exceeded quota. The client classifies these from the status code and keywords, and that mapping is untested against the real service.
- Coverage of IKA, IST, SAW, DXB, DOH, LHR, LGW, FRA, CDG and AMS. Run Developer Panel → Aviation Edge → **Coverage probe** (10 calls) and paste the table here.
- Whether Iranian carriers (IR, W5, EP, QB and others) appear at all. Even if they do, they are dropped by the BLOCK carrier policy (ADR-0034, rule 5). Foreign carriers at IKA are shown with the Iran-lane review notice.
- The real horizon (documented as up to 1 year) and the minimum lead time (about 7 days), the overnight-arrival behaviour, and whether `arr_iataCode` filtering behaves as documented.
- Per-second limits: none are documented.

## Side effects in the dev environment
- On boot, the API imported `.env` `FLIGHTAPI_KEY` into `provider_credentials` (`flightapi`), as designed. The worker's boot tick then got 403 from FlightAPI and paused the catalog with AUTH, which is existing behaviour. That key looks invalid.

## Open items
- Counsel: Aviation Edge terms §8.6 (sanctions representation), recorded at STAGE-0 Q9. §8.1 purge on unsubscribe is in `docs/runbooks/flight-catalog.md`.
- Mobile uses `/v1/flight-searches` and shows no schedule results (out of scope).
- "Nearby dates" and the popular-route cards read the priced layer only.
- Live flight status from `/timetable` is not built.

## Deploy notes
Run migration 0025. No new permission (Valkey `perm:*` needs no flush). Add the key in the Developer Panel, test, run the coverage probe, set the budget, then enable.

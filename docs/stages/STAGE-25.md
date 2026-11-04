# Stage 25 record: FlightAPI.io as a catalog source (4 Nov 2026)

Sources:
- Owner request of 4 Nov 2026 (a FlightAPI.io key, to fill the stage-24 catalog).
- ADR-0035. It builds on ADR-0034 and ADR-0029; it does not change the write path or the public snapshots.

This stage is not part of the booklet.

## Built
- **Adapter** `apps/api/src/modules/suppliers/adapters/flightapi/`: `client.ts` (90 s timeout, key only in the URL path and never in an error, 401/403 → AUTH, 402 → credits exhausted, 429 → rate limit, refuses the real host under `NODE_ENV=test`) and `normalise.ts` (Skyscanner shape → `NormalisedOffer[]`; cheapest first, top `maxResults`, self-transfers dropped, UNKNOWN brand, baggage and conditions).
- **Settings** `source`, `flightapiMonthlyCredits` (1000), `flightapiReserveCredits` (100) in `CatalogSettings`. `source` defaults to `flightapi` when `FLIGHTAPI_KEY` is set.
- **Pacer** `creditBudget` and `selectFlightapiSlots` (engine), `tickFlightapi` and `runCalls` (`catalog-refresh.service.ts`): same lock, same priority order, a pro-rata share of the month's credits, one call at a time (two at once), `writeSlot` after each answer.
- **Ledger** migration `0023_flightapi_credits` adds `credits` and `meta` to `provider_usage_ledger`; one row per tick or staff action.
- **Staff** "refresh slot now" and revalidate work with `flightapi` and draw on the reserve credits. The quote returns `estimatedCredits` and `reserveLeftCredits`.
- **Console** source selector and the two credit fields in the catalog settings; a credits line in the usage view; en and fa strings.
- **Credential** env `FLIGHTAPI_KEY` (`.env.example`, `infra/compose.prod.yml`, which `compose.vps.yml` inherits for api and worker).

## Verified (OBSERVED, local stack)
- **Typecheck:** api and console clean.
- **Engine:** 35/35, including the credit budget.
- **Contracts:** 24/24. **API unit:** 209/209 (8 new normaliser tests on a trimmed real IST→LHR response).
- **Catalog e2e:** 83/83 (71 existing plus 12 new in `test/catalog-flightapi.e2e.ts`): slots written, credits ledgered, concurrency 2, lock, share cap and budget pause, 401 AUTH pause and resume on key change, 402 BUDGET, 429 circuit, 400 slot error, empty slot, staff refresh and revalidate on the reserve, and no key in any ledger row, state, job or event. `catalog.e2e.ts` now also traps `FlightapiClient.onewayTrip` on every public path.
- **One live call** through the new client and normaliser (IST→LHR, 11 Nov 2026, 2 credits): 63 itineraries, 5 offers kept, cheapest first. Not written to the database; the running api and worker were not restarted.

## Not done
- No commit and no deploy. Migration 0023 is uncommitted (hand-written like 0003-0022; the journal entry is added by hand).
- No Integrations (Developer Panel) credential for FlightAPI: env only.
- Raw FlightAPI responses are not stored.
- The plan's monthly allowance is UNKNOWN; 1000 is a placeholder.
- An itinerary through an airport missing from our reference data is dropped (`UNKNOWN_AIRPORT`), as in the Apify path.

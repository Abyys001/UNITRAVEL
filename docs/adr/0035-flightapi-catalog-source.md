# ADR-0035 · FlightAPI.io as a second source for the flight catalog

Status: accepted. Requested by the owner on 4 Nov 2026 in session unitravel-88, who has a FlightAPI.io API key and wants it to fill the stage-24 catalog (ADR-0034, `docs/build/PLAN-flight-catalog.md`).

This ADR adds a source. It changes nothing in ADR-0034 except where it says so: customers are still served from stored snapshots only, and the write path (`CatalogWriteService.writeSlot`) is unchanged.

## Context
- **FlightAPI is a commercial API with a key.** `GET https://api.flightapi.io/onewaytrip/{key}/{from}/{to}/{date}/{adults}/{children}/{infants}/{cabin}/{currency}` is a documented endpoint of a paid service. (OBSERVED: one live call on 4 Nov 2026)
- **One call is synchronous and slow.** It took about 30 to 60 s and costs 2 credits. (OBSERVED)
- **The key is in the URL path.** Anything that prints, stores or throws the URL leaks it. (OBSERVED)
- **The allowance is unknown.** We do not know the plan's monthly credits. (UNKNOWN)
- **The response is Skyscanner-shaped.** `itineraries`, `legs`, `segments`, `places` and `carriers`, with local times that carry no zone, and the currency comes from the request. (OBSERVED, 1 MB sample)

## Decisions

| # | Decision |
|---|---|
| D1 | **Allowed under rule 2.** FlightAPI is a documented commercial API used with its own key. Our code does not scrape, use undocumented endpoints, or bypass authentication, bot detection or rate limits. The one-source exception in rule 2 (Google Flights through Apify, ADR-0029) is not widened: this is a keyed API, not a scraped source. |
| D2 | **Indicative, like ADR-0029.** Offers carry `confidence: INDICATIVE`, rung `CACHED_OFFER` and the provider id `flightapi`. Brand, checked and cabin baggage, change and refund conditions and seat selection are always UNKNOWN (rule 3). Prices are staff-only: the public snapshot allowlist is unchanged, so no price, currency or provider field reaches a customer path. |
| D3 | **The same write path.** The adapter returns `NormalisedOffer[]` and the pacer files each slot with `writeSlot`. Carrier and lane compliance (Iranian carriers BLOCK, Iran lanes REVIEW), price history, snapshots without prices, the version bump, the outbox event and write-time self-transfers all apply as before. |
| D4 | **What the adapter keeps.** The price is the cheapest `pricing_options` amount, in the request's currency. Itineraries whose leg is `self_transfer: true` are dropped, because our own joiner builds self-transfers. Offers are sorted cheapest first (shorter journey on a tie) and cut to the route's `maxResults` (default `defaultMaxResults`). Offers for another route or date than the slot's are dropped with a notice. The identity key is the same as Apify's (flight numbers, first local departure, cabin), so a slot keeps its history when the source is switched. |
| D5 | **Source switch.** `CatalogSettings.source` is `apify` or `flightapi`. The default is `flightapi` when `FLIGHTAPI_KEY` is set, otherwise `apify`; a stored choice always wins. With `apify` nothing changes: the Apify client, its pinned build and forced-off cost fields, its `maxResults` and `maxTotalChargeUsd` on every run, and its dollar budget. |
| D6 | **Credit budget.** `flightapiMonthlyCredits` (default 1000) is staff-set because the plan is unknown. `flightapiReserveCredits` (default 100) is held for staff "refresh now" and revalidation. The month is the calendar month in UTC. A tick may use `(monthly − reserve − used) ÷ ticks left` credits, at 2 credits a slot, in the existing priority order and capped by `maxSlotsPerRun`. In the last `releaseReserveHours` of the month the unused reserve is released to refreshes. When under one call's credits remain, the pacer pauses with BUDGET until the month turns over. |
| D7 | **A credit ledger.** `provider_usage_ledger` gets `credits` and `meta` (migration 0023). One row per tick or staff action, provider `flightapi`, written before the first call so the credits count while the batch runs. A refused or unreached call books 0; a timed-out call keeps its 2 credits because it may have been billed. Apify's dollar arithmetic ignores these rows. |
| D8 | **One call at a time, two at once at most.** A tick holds the existing Redis lock `catalog:refresh:lock` and renews it after each call. Each answer is filed with `writeSlot` immediately. |
| D9 | **The failure matrix is kept.** 401/403 → AUTH pause (resumes when the key changes, detected by a fingerprint, or on staff Resume). 402 → BUDGET pause until the month turns over. 429, 5xx and timeouts → a failed tick; three in a row open the CIRCUIT. 400/404/422 mark the slot as an error, so the error skip stops asking. An empty answer is an empty slot, so the empty streak and backoff apply. |
| D10 | **Staff actions.** "Refresh slot now" and revalidate work with `flightapi`: the quote shows credits, the calls run in the background under the same lock, and they draw on the reserve credits. |
| D11 | **The key never leaves the process.** `FLIGHTAPI_KEY` is an environment secret (api and worker). It is never logged, never in an error message, never stored in a run, ledger row, payload or audit entry. The client rebuilds every error from the status code, and the URL is never written down. Under `NODE_ENV=test` the client refuses the production host unless a mock base URL was injected or `fetch` is a test double. |

## Not decided here
- **Integrations credential.** The Apify token can also be entered in the Developer Panel. FlightAPI reads the environment only: a panel credential needs a `providers` row, a `ProviderId` panel entry and a test action. Add it when the owner asks.
- **Raw payload storage.** The 1 MB responses are not stored. The Apify path stores them in object storage for 14 days.
- **The plan's real allowance.** Set `flightapiMonthlyCredits` once the owner knows it.

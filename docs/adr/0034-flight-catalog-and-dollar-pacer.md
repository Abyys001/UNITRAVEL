# ADR-0034 · Scheduled flight catalog and dollar pacer; customer search reads stored data only

Status: accepted. Approved by the owner in session unitravel-87 on 4 Nov 2026 ("Plan approved with these decisions"). The plan is `docs/build/PLAN-flight-catalog.md`.

Sources:
- The spec "Flight Catalog & Refresh Pacer" (`docs/integrations/flight-catalog-refresh-spec.md`, owner).
- The owner's build brief of 4 Nov 2026, whose settings override the spec defaults.

This ADR supersedes **ADR-0029 A6** (the customer on-demand cache, the 40/30/30 pools and the hourly customer cap) and **ADR-0032 B3** (prewarm). ADR-0029's other decisions still apply: results are indicative, baggage and fare conditions are UNKNOWN, and prices are staff-only. So does ADR-0031: Iran lanes are REVIEW and Iranian carriers are BLOCK.

## Context
- **Customer traffic can spend Apify money.** A cache miss on `POST /v1/flight-searches` starts a paid Apify run (`FlightDataService.lookup`). The Free plan is $5 per billing cycle. (OBSERVED)
- **A KAYAK fallback is on by default.** The actor's input schema (build 0.1.167) defaults `kayakWhenGoogleEmpty` to **true**. That starts a KAYAK run billed by a separate actor. Our client never sent the field, and its comment claimed it was off. (OBSERVED, public build endpoint, no run started)
- **`maxResults` is one value per run.** It cannot differ between routes in the same run. (OBSERVED)

## Decisions

| # | Decision |
|---|---|
| C1 | **Customer search reads only the catalog.** Customer and anonymous requests never reach a provider. The catalog lives in Postgres: `flight_results`, `flight_result_pricing` and `catalog_public_snapshots`. Customers are served from Redis and the snapshots only. `POST /v1/flight-searches` and its GET/SSE routes become staff-only. Prewarm is removed. |
| C2 | **A dollar pacer.** A BullMQ scheduler runs a tick every 24 h ÷ `refreshTicksPerDay` (4 h), plus one catch-up tick when the worker starts. Each tick:<br>• spends at most `(budget − safety − unused reserve − spent) ÷ ticks left`;<br>• starts one asynchronous run under the Redis lock `catalog:refresh:lock`.<br>Admin runs (revalidate, "refresh now", staff search) draw on the reserve first. The unused reserve is released in the last 12 h of the cycle. Spend is read from Apify `GET /v2/users/me/limits`. If that call fails, the pacer uses the ledger × `costCorrection` and never assumes zero. |
| C3 | **One `maxResults` group per run.** Each run takes the group of its highest-priority slot. Routes set `max_results` individually: IKA→IST 3, IST→LHR 5. |
| C4 | **Cost settings forced off.** Every run sends `kayakWhenGoogleEmpty`, `fillMissingPricesFromKayak`, `resolveBookingOptions` and `resolveReturnFlights` as `false`. The client enforces this whatever the caller passes. Every run also sends `maxResults` and `maxTotalChargeUsd`. |
| C5 | **Pinned actor build.** Runs use `build=0.1.167`. A free weekly check of the default build alerts admin if the build changes or any field in C4 is missing or renamed. |
| C6 | **A cost ledger that survives the cycle.** `provider_usage_ledger` records cost (estimated, maximum charge, actual) and links to `provider_runs`. It is never purged within a billing cycle. The `provider_calls` payloads keep their separate 14-day retention. |
| C7 | **Self-transfer itineraries are combined when data is written.** Pairs such as IKA→IST + IST→LHR are joined with the existing `joinAtHub`/`buildItinerary`. The rules are admin-editable connection settings: hubs, a 4–6 h layover, the same airport, no overnight connections, and day offsets 0/+1. Results are stored under the COMBINED route IKA→LHR and labelled "Separate tickets · self-transfer". Settings can never loosen a carrier, airport or lane block. |
| C8 | **Customer snapshots use an allowlist.** `PublicItinerary` has no field for an amount, currency, fare, baggage or provider. The price-leak test covers the new endpoints and the snapshots. |
| C9 | **Account hard cap.** The Developer Panel has a button that sets `PUT /v2/users/me/limits {maxMonthlyUsageUsd}` to the budget. It requires step-up and is audited. It is never automatic, and the owner is asked before its first use. |
| C10 | **Freshness targets.** The brief's targets apply: 0–2 days out every 8 h, 3–7 days every 24 h, 8–14 days every 72 h. The floor is 4 h. After 2 empty results in a row, the interval doubles each time, up to ×8. A slot is hidden after 7 days without fresh data. These are targets: the pacer protects the budget first. |

## Consequences
- **Customers wait for the schedule.** A new route-date shows the "not tracked" or "empty" state with the request form until the pacer refreshes it.
- **Policy changes need a snapshot rebuild.** Snapshots are built when data is written, so a change to a policy or to the serializer needs `catalog.snapshots.rebuild`. The rebuild costs nothing on Apify.
- **Deployed hosts need the Iran lane policy.** Each deployed host needs the `FLIGHT:IR:*` lane policy set to REVIEW through the compliance policy screen. The local seed adds it only when `APP_ENV=local`. If the row is missing, Iran results would be shown without the review notice.

# ADR-0036 · Aviation Edge as a schedule-only source beside the priced catalog

Status: accepted. Requested by the owner on 10 Nov 2026 (brief "Integrate Aviation Edge Flight Data API"); plan approved in the same session. Stage record: `docs/stages/STAGE-27.md`.

This ADR adds a source of a different kind. ADR-0034 (catalog, customers read stored data only) and ADR-0035 (FlightAPI) stay as they are, except where this ADR says so.

## Context
- **Aviation Edge (AE) sells schedule data, not offers.** It has no prices, fares, seats or booking classes. Its FAQ says "we do not provide any data regarding flight tickets and seat availability (booking information)". (DOCUMENTED, aviation-edge.com/frequently-asked-questions, read 10 Nov 2026)
- **Future schedules.** `GET https://aviation-edge.com/v2/public/flightsFuture?key=…&type=departure&iataCode=IKA&arr_iataCode=IST&date=YYYY-MM-DD` returns one airport's departures on one date, and `arr_iataCode` narrows them to one route. It reaches "up to 1 year ahead". The FAQ says it starts at least 7 days ahead. (DOCUMENTED)
  - Rows are built by "an algorithm" from aggregated airport and airline data, so they are a prediction, not a published timetable. (INFERRED from DOCUMENTED wording)
  - Each row has `weekday`, `departure`/`arrival {iataCode, icaoCode, terminal, gate, scheduledTime "HH:MM"}`, `aircraft {modelCode, modelText}`, `airline {name, iataCode, icaoCode}` and `flight {number, iataNumber, icaoNumber}`.
  - Times are airport-local with no date and no zone. There is no status, codeshare or estimated time. (DOCUMENTED)
- **Real-time timetable.** `/timetable` has status, estimated and actual times, gate and codeshares, but only for one airport over about the next 12 hours. It is not useful for route-and-date search. (DOCUMENTED)
- **Key and errors.** The key is the `key` query parameter. Error bodies and status codes are not documented, except a "No Record Found" error. Failed calls are not counted. (DOCUMENTED / UNKNOWN)
- **Plans and terms.**
  - Plans are priced by calls per month: Developer 30k, Business 100k, Business Gold 500k. (DOCUMENTED, premium-api page)
  - §4.2 allows use inside our own applications. §4.2 and §8.2 forbid resale, redistribution and mirroring.
  - §8.1 forbids storing or using the data after the subscription ends.
  - §8.6 has the subscriber represent that it is not subject to sanctions or export restrictions. (DOCUMENTED, /api-terms-of-service)
- **The catalog write path is offer-only.** `CatalogWriteService.writeSlot` always writes `flight_result_pricing`, and it retires every slot row that it did not just write. (OBSERVED)
- **Coverage.** No AE page mentions Iran, IKA, Iran Air or Mahan. (UNKNOWN until probed with a key)

## Decisions

| # | Decision |
|---|---|
| E1 | **Allowed under rule 2.** AE is a documented commercial API used with its own key. Our code does not scrape, use undocumented endpoints, or bypass authentication or limits. The Apify exception (ADR-0029) is not widened. |
| E2 | **A separate truth level (rule 3).** Schedules live in their own tables, `catalog_schedule_slots` and `flight_schedules` (migration 0025), never in `flight_results` or the pricing tables. A schedule row is never an offer, a quote input or a basis for a price. |
| E3 | **What customers see.** `PublicItinerary.basis` is `OFFER` or `SCHEDULE`, and snapshots written before this ADR read as OFFER. A SCHEDULE item carries the label "Scheduled · not confirmed availability". The request flow is unchanged: staff still find and quote a real offer. |
| E4 | **Merge on read, the priced source wins.** `CatalogReadService` serves the priced snapshot plus the schedule snapshot of the same slot. A schedule item with the same flight numbers and the same local departure minute as a priced item is dropped. The priced item takes AE's terminal and aircraft where its own are missing. The slot shows results when either layer has rows. |
| E5 | **Its own pacer.** A BullMQ tick every 4 h runs under the lock `catalog:schedule:lock`, separate from the priced source.<br>• It fills watched DIRECT slots between `aviationEdgeMinDaysAhead` (7) and `aviationEdgeMaxDaysAhead` (60) days out, each every `aviationEdgeRefreshHours` (72).<br>• It makes one call per slot.<br>• COMBINED routes are never called. Their self-transfers are built from the hub slots' schedule legs with the existing connection rules (ADR-0034 C7). |
| E6 | **A call budget.** `aviationEdgeMonthlyCalls` (default 30000) and `aviationEdgeReserveCalls` (500) are staff-set. The month is the calendar month in UTC. A tick may use `(monthly − reserve − used) ÷ ticks left` calls. Calls are booked in `provider_usage_ledger` (provider `aviation-edge`, `credits` = calls). Tests and coverage probes draw on the reserve. |
| E7 | **Failure matrix.**<br>• 401/403, or a body naming the key → AUTH: the credential is marked invalid and the pacer pauses until the key is replaced.<br>• 429, or a quota body → RATE_LIMITED: the tick stops.<br>• 5xx and timeouts → one retry after 2 s, then a failed slot; three failed ticks in a row pause on CIRCUIT.<br>• "No Record Found" → an empty slot.<br>• A non-array or non-JSON body → BAD_RESPONSE.<br>A row with a missing field is dropped with a notice and never filled in. |
| E8 | **Times.** The local time is the slot date plus `HH:MM` in the airport's zone (reference data). An arrival earlier than the departure moves to the next day, only if the duration is then under 20 h; otherwise the row is dropped. The predicted gate is kept for staff only. |
| E9 | **Compliance applies unchanged.** The write-time filter drops BLOCK carriers (Iranian carriers), airports and lanes, and marks Iran lanes REVIEW. Coverage of an airport does not change a policy. |
| E10 | **The key lives in the Developer Panel only.** It is stored in `provider_credentials` (envelope AES-256-GCM) and is write-only, masked to the last 4 characters, behind step-up and audited with key names only. It is read at call time with `SuppliersService.credentials("aviation-edge")`. There is no env variable and no env import. It is never logged or thrown: the URL holds the key, so errors are rebuilt from the status code. `AVIATION_EDGE_BASE_URL` is honoured only in a sandbox, for test mocks. |
| E11 | **The provider row.** `aviation-edge` has every capability false, so it is never a searchable offer adapter. `enabled` switches the pacer, and disabling it keeps the credential. The panel has a dedicated test (one call, IKA→IST, today + 8 days) and a staff-run coverage probe (10 calls, the priority airports). |
| E12 | **FlightAPI in the panel (ADR-0035 follow-up).** A `flightapi` providers row lets staff enter its key in the panel. The panel key wins, and `FLIGHTAPI_KEY` is imported once when nothing is stored, as `APIFY_TOKEN` is. Source selection (`CatalogSettings.source`) is unchanged. |

## Consequences and open items
- **§8.6 sanctions representation.** Whether Uni Travel can give it is counsel-owed (STAGE-0). The code ships with the provider disabled.
- **§8.1 data after the subscription.** When the subscription ends, staff disable the provider and purge AE rows (runbook `flight-catalog.md`).
- **Not verified with a key.** Real coverage of IKA and the other airports, the actual horizon and minimum lead time, error bodies and quota behaviour are not verified (STAGE-27, UNKNOWN).
- **Mobile.** Mobile still uses `/v1/flight-searches` and shows no schedule results.
- **Live status.** Flight status from `/timetable` for booked flights is a possible later step; it is not built.

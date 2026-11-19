# ADR-0037 · Flight Builder as a staff-capture source and the request-based catalog workflow

Status: accepted. Requested by the owner on 19 Nov 2026 (brief "Complete Flight Data, Customer Request & Admin Flight Management Implementation"). Research: `docs/integrations/EXTERNAL-FLIGHT-PANEL-RESEARCH.md`. Field reference: `docs/integrations/FLIGHT-DATA-DICTIONARY.md`. Stage record: `docs/stages/STAGE-28.md`.

ADR-0004 (price confidentiality), ADR-0029 (Apify, the only scraped source), ADR-0034 (catalog served from stored data), ADR-0035 and ADR-0036 stay in force except where this ADR says so.

## Context
- **Flight Builder (FB)** is the Amadeus airQuest web panel used by Uni Travel's agency account. It is server-rendered HTML. It has no data API. (OBSERVED 19 Nov 2026)
- **Search quota.** Settings → Scan Hits counts searches per booking. Warning at 45, critical at 50. One search consumed 1 hit, another consumed 2. (OBSERVED)
- **Rule 2 forbids scraping.** Automated access needs a contract or written permission. Amadeus has not answered Q7–Q9. (BLOCKED)
- **Panel data.** The panel shows, per option, the following. (OBSERVED)
  - Per-class "Free" seats from 1 to 9. The meaning of 9 is UNKNOWN.
  - Fare type, fare basis, base, tax and total in GBP.
  - Per-segment checked baggage, the latest ticketing date and free-text fare rules.
- **Catalog writes replace the slot.** `CatalogWriteService.writeSlot` retires every current row in the slot that it did not just write. (OBSERVED)

## Decisions

| # | Decision |
|---|---|
| D1 | FB is a **staff-capture** source. Staff search the panel by hand and record the chosen options in the admin panel. There is no FB HTTP client in the repository; a test asserts this. An automated adapter would need a recorded written authorisation *and* its own ADR. That ADR would also need an SSRF guard if any URL is fetched. |
| D2 | Captures go into the one catalog, `flight_results`. A new column `capture` takes FEED or STAFF. `writeSlot` retires only FEED rows. The customer snapshot is rebuilt from all current rows in the slot, so feed refreshes never remove staff captures. When a STAFF row and a FEED row have the same flight numbers and departure, the STAFF row wins. STAFF rows never feed self-transfer combinations. |
| D3 | Each bookable class option is a row in the new table `flight_result_fares`.<br>• Price (base, taxes, total, currency and penalty amounts) is served only with `pricing.read.internal` (ADR-0004).<br>• Fare type, fare basis and the raw rules text are visible to all staff, because staff need them to check the option.<br>• None of these ever reach a customer response. |
| D4 | Customers see the following, **by the owner's decision** (this overrides the research recommendation to keep seats staff-only):<br>• booking class and cabin<br>• the seat value as the panel showed it, with 9 labelled "9 or more (not confirmed)"<br>• tri-state checked baggage with the source wording<br>• change and refund conditions<br>• ticketing deadline, freshness and observation time<br>Fares are ordered by cabin and class, never by price. Q10 for Amadeus: may FB availability be shown to end customers? |
| D5 | Customers request a catalog fare with request kind `CATALOG`. On submission the immutable `offer_snapshots` row stores two copies: the customer copy (exactly what was shown) and the staff copy (with price). The request creates no payment, invoice or reservation. A STALE or EXPIRED fare is refused with 409 `OFFER_EXPIRED`. |
| D6 | Connection state is derived and never stored: DISABLED, NOT_CONFIGURED, ACCESS_RESTRICTED, AUTHORIZATION_PENDING, AUTH_FAILED, CONNECTED, CONFIGURED. CONNECTED requires an authorised verification. No code path can produce one today. |
| D7 | Credentials (username, password) use the existing write-only `PUT /v1/dev/providers/flight-builder/credentials`, with AES-256-GCM envelope encryption and step-up. No code path decrypts them. The panel URL is a non-secret setting, shown as a link only, and is never fetched by the server. |
| D8 | Quota observations are an **append-only** log. Each entry records bookings, scan hits, thresholds, the source (MANUAL, REPORTED or ESTIMATED), the observer and a note. Headroom is computed and labelled ESTIMATED. Nothing is seeded and nothing is decremented automatically. |
| D9 | Sync mode is DISABLED, MANUAL or SCHEDULED. The interval is HOURLY, DAILY or WEEKLY. The default is DISABLED. While the authorisation gate is unmet, the mode cannot leave DISABLED (409 `AUTHORISATION_REQUIRED`). Refresh and the scheduled job record a BLOCKED run with the reason and make no provider call. |
| D10 | Freshness is checked by a 15-minute sweep that needs no provider: FRESH under 6 h, AGING under 24 h, then STALE. STALE results are hidden from customers. A fare whose ticketing date is past is EXPIRED. The deadline timezone is UNKNOWN, so expiry is at 00:00 UTC of the deadline date, which errs early. |
| D11 | Two new permissions. `catalog.capture` (admin, owner) covers recording options and quota observations. `provider.authorisation.record` (owner only, privileged, step-up) covers recording or revoking the written permission. Settings use `provider.config.write`. Supplier prices use `pricing.read.internal`. |
| D12 | The request state machine is unchanged. The owner's statuses map to existing ones:<br>• Submitted → SUBMITTED<br>• Under review → IN_REVIEW<br>• Quotation prepared → IN_REVIEW with a draft quote<br>• Customer response pending → QUOTED<br>• Accepted or declined → ACCEPTED or DECLINED<br>• Booking recorded → RESERVED or TICKETED<br>Labels are config. |

## Data model (migration 0027)
- **`flight_results`** gets four new columns:
  - `capture` (FEED or STAFF)
  - `captured_by`
  - `source_record_id`
  - `verification` (RECORDED or VERIFIED)
- **`flight_result_fares`**, one row per booking-class option:
  - Per-segment class, raw seats and fare basis are stored as arrays.
  - Fare: fare type and its raw form.
  - Price: base, taxes, total and currency.
  - Baggage and conditions as jsonb, with source text.
  - Ticketing deadline, status (LIVE, STALE, EXPIRED or RETIRED) and `observed_at`.
- **`offer_snapshots`** gets `catalog_result_id`, `fare` (the staff copy) and `customer_view` (the customer copy).
- New tables:
  - `provider_authorisations`, append-only except for revocation.
  - `flight_builder_usage_observations`, append-only.
  - `flight_builder_sync_runs`.
- A new `providers` row `flight-builder`, disabled. Settings live in the key `flight_builder`.
- Rollback: the migration only adds. To roll back, set `flight_builder.enabled=false` and retire the STAFF rows.

## Consequences
- Staff work stays manual. It now lands in one validated store and is linked to requests and quotes, and the quota is visible.
- Customers see real captured options with their limits and uncertainty. They never see a price.
- The research recommendation (G1–G4) still holds for automation. This ADR does not authorise any automated access.

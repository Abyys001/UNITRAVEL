# Stage 22 record: Apify Google Flights on `/flights` (2–3 Nov 2026)

Source: owner briefs of 2 Nov 2026 (ADR-0029) and 3 Nov 2026 (ADR-0032); ADR-0031. Not part of the booklet. The backend landed in commit `bb34763` and the lane policies in `f6d14b0`. This record covers the uncommitted ADR-0032 work done in session unitravel-23.

## What changed (DOCUMENTED)
- **Token.** On first API start, an `APIFY_TOKEN` from `.env` is imported once into the encrypted credential store. The import is audited as `provider.credential.imported_from_env` with the last 4 characters only. After that the stored credential is used and env is ignored. `.env.example` has `APIFY_TOKEN=`.
- **Developer Panel.**
  - Apify page: write-only key (last 4, rotatedAt, rotatedBy), Test connection (`POST /v1/dev/providers/apify-google-flights/test`, reading `/users/me/limits`), and replace or disable behind step-up.
  - Audit trail and help box in en and fa, shown read-only to `provider.config.read`.
  - Usage tile on the dev home.
  - The generic credential dialog now saves the Apify key as `token`, which the API reads (before, it used `apiKey`).
- **Warming.**
  - One batched prewarm run, `maxResultsPrewarm` 10, one date per route rotating over the next 14 days.
  - Interval = 720 h ÷ ⌊prewarm pool ÷ cost per warm⌋, at least 6 h. With the defaults that is 52 h (OBSERVED in the spec).
  - The worker then runs one `SYSTEM` search per route so listings go through the normal engine and policies. Ten default routes are in `defaults.ts`.
- **`/flights`.**
  - Removed: the live aircraft board, `GET /v1/live-flights` and its contract, the adsb.lol poller, its strings and its styles (ADR-0027 superseded, DPIA R20 closed).
  - Added: popular-route cards with airline, flight numbers, operating carrier, local times, duration, stops, layovers (≥ 4 h highlighted), aircraft, cabin, data age, the A11 disclosure and the I5 Iran note.
  - "Request this flight" uses the existing `/request/new?s=&i=` ITINERARY flow, or a manual request when there is no offer reference.
  - An empty state.
- **Console.**
  - Request detail: source badge; price, price level and Google Flights link for `pricing.read.internal`; Revalidate now (existing recheck routes, staff pool); UNKNOWN banner pointing to the quote block.
  - Admin dashboard: usage card through the new `GET /v1/admin/providers/apify-google-flights/usage` (`provider.config.read`).
- **Contracts.** `FlightListingItem` gained `segments`, `offerRef` and `complianceReview`, and no price fields. Also new: `DevApifyTestResult`, `maxResultsPrewarm`, the `SUPPLIER_AUTH` error (HTTP 502), and the search owner type `SYSTEM`. OpenAPI regenerated (247 paths). The permission catalogue is unchanged.

## Verified (OBSERVED, local stack, `APIFY_TOKEN` empty, no real Apify call)
- Typecheck 9/9 workspaces.
- Unit:
  - API 185/185, contracts 24/24, engine 13/13, i18n 22/22, db 8/8, ui 3/3.
  - Domain 115/116: the known flaky `name-matcher` property test, which passed 9/9 on rerun.
- API e2e, one file per run: every file passes except `services.e2e` (8/9, `CLUB_DISABLED`: club is off in the shared database). `matrix.e2e` 24/24, `phase-j.e2e` 31/31 including the new price-leak test.
- A single whole-suite run hits 429 rate limits (OTP cooldown, TOTP 10/600 s).
- Playwright:
  - Console `adr0032-apify` 8/8 (mocked).
  - Web `popular-flights` 7/7 (mocked).
  - Web `adr0032-fullstack` passes against a local Apify mock (`apps/api/test/fixtures/apify/mock-server.ts`). The run went `/flights` → Request this flight → sign-in redirect → submit → console list and detail with badge and staff price → Revalidate shows "Still listed".
  - Two shortcuts in the full-stack run: the customer was created through the API with a verified phone, because the seeded customer's phone is unverified, and staff used the LOCAL-DEV test sign-in because of the OTP cooldown.
- Price leak:
  - `/en/flights` and `/fa/flights` HTML plus 16 JS chunks, a customer search, an anonymous itinerary read and the listing payload contain no `priceLevel|bookingToken|googleFlightsUrl|google.com/travel|"price"|"amount"`.
  - The only `"total"` is the result count in the search response.
- A search for the Apify token prefix (`git grep`, also with `--untracked`) finds nothing. `.env` is ignored and not staged. There is no Apify credential in the local database.
- Lint: no workspace has a lint script, so there is nothing to run.

## Not verified / open
- **Visual baselines are stale.** Web `visual.spec` has 88 failures and console `visual.spec` 62: screenshot diffs, and cassettes missing `GET /v1/site` and the new dev-health Apify calls. They need re-recording through the visual-capture workflow.
- **Other Playwright failures, attributed to shared-database flags or rate limits (INFERRED):**
  - Flags: web `content-pages` (visa off), `site-menu` hotels.
  - Seed data: `customer.spec` (seeded phone unverified).
  - Rate limits and other: console OTP login (cooldown), `adr0013`, `content.spec`.
- **Popular routes are empty in local settings.** The shared local settings have no `listings.flightRoutes`. The defaults apply only to a fresh seed, so an existing database (and each deployed host) needs the routes published through the settings screen (OBSERVED locally).
- **Listing requests may fail for other passenger mixes.** Listing searches are for 1 adult. The ch. 12.4 rule that travellers must match the searched passengers may refuse other mixes (INFERRED, `requests.service.ts:147`).
- **Plan name not shown.** `DevApifyTestResult.plan` is always null, because `/users/me/limits` carries no plan name (UNKNOWN without `GET /v2/users/me`).
- **Real fixtures, live smoke run and real import are not done.** Recording real fixtures, the live smoke run (`maxTotalChargeUsd=0.02`) and the real token import all wait for owner approval. The fixtures in use are synthetic.
- Committed in 17ea4b0 and merged in 092f160 by session unitravel-2c (owner request). Deployed to the VPS on 4 Nov 2026 by the same session; its migration records were checked first (Apify migration applied as 0021). The VPS has no Apify credential yet (INFERRED), so the provider stays off and `/flights` shows the empty state.

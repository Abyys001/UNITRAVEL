# STAGE-28 · Flight Builder staff capture and the request-based catalog workflow (ADR-0037)

Owner brief of 19 Nov 2026: complete flight data, customer request and admin flight management around Flight Builder (FB), with no online payment in the flow. Research is in `docs/integrations/EXTERNAL-FLIGHT-PANEL-RESEARCH.md` and the field reference in `docs/integrations/FLIGHT-DATA-DICTIONARY.md`. The design is in `docs/integrations/FLIGHT-BUILDER-DESIGN.md`. Recorded verification replaces the stage gate (rule 9). Not committed.

## What was built

**Contracts and domain**
- `packages/contracts/src/flight-builder.ts` defines the capture input, `PublicFare` (strict, no amounts), the staff fare views, settings, authorisation, usage, sync and status.
- `packages/domain/src/flight-builder.ts` holds the connection state, sync gate, fare freshness, deadline warning, usage summary (scan hits per booking) and seats reported.
- Enums gain the `CATALOG` request kind and quote source, and the `flight-builder` provider.
- Two new permissions: `catalog.capture` (admin, owner) and `provider.authorisation.record` (owner, privileged).

**DB (migration 0027)**
- `flight_results` gets `capture` (FEED or STAFF), `captured_by`, `source_record_id`, `verification`, `request_ref` and `capture_note`.
- New tables:
  - `flight_result_fares`
  - `provider_authorisations` (revocation only)
  - `flight_builder_usage_observations` (append-only)
  - `flight_builder_sync_runs`
- `offer_snapshots` gets `catalog_result_id`, `fare` (staff copy) and `customer_view`.
- New provider row `flight-builder`, disabled.

**API**
- **Capture, list and retire** options under `v1/admin/flight-builder`. Capture runs the normaliser (`suppliers/adapters/flight-builder/normalise.ts`) and the compliance filter, then `writeStaffOption`.
- **Usage log** for scan-hit observations.
- **Developer routes** under `v1/dev/providers/flight-builder`:
  - state
  - settings (409 `AUTHORISATION_REQUIRED`)
  - authorisations, with step-up
  - sync runs
  - refresh: always a BLOCKED run, with 409 `SOURCE_NOT_AUTHORISED` or `NO_ADAPTER`
- **Catalog writes.** `writeSlot` retires only FEED rows, and STAFF rows win over duplicates.
- **Customer routes.**
  - `GET v1/flights/results/:id` returns LIVE `fares`.
  - `POST v1/flight-requests` accepts kind CATALOG. It stores an immutable snapshot, returns 409 `OFFER_EXPIRED`, and creates no payment, invoice or reservation.
- **Quote builder.** `POST v1/admin/flight-requests/:ref/quotes/from-catalog` prefills a quote option and keeps the tri-state data.
- **Jobs.** `flight-builder.freshness` runs every 15 minutes. `flight-builder.sync` is scheduled only for SCHEDULED mode and records BLOCKED.
- There is no FB HTTP client, and the panel URL is never fetched (static test).

**Admin Panel**
- `/catalog/flight-builder`: option list with freshness, deadline, status and supplier total (behind `pricing.read.internal`), plus a quota banner.
- `/catalog/flight-builder/new`: capture form; linking it to a request adds an internal note.
- `/catalog/flight-builder/usage`: gauge with markers at 45 and 50, charts, the observation log and an "Estimate" label on headroom.
- Request detail: a staff fare panel inside the snapshot (supplier base, tax and total; fare type and basis; rules text; freshness).
- Quote builder: a "+ From catalog option" action.

**Developer Panel**
- `/providers/flight-builder`:
  - Connection state, and the panel URL (shown as a link, never opened).
  - Write-only credentials and the written-permission record.
  - Sync mode and interval, and the run history.
  - A "Refresh Flight Data" button with a confirmation; it shows the refusal.

**Customer web**
- The flight details page has a booking-class picker. For each class it shows:
  - seats reported (9 reads "9 for 9 or more; not confirmed")
  - per-segment baggage with the source wording
  - change and refund conditions
  - ticketing deadline and observation time
- The request flow uses `?catalog=&fare=`. The request page says "Your flight request has been submitted. This is not a confirmed booking or ticket." and shows the chosen fare.
- Every new string is in English and Persian.

**Repository**
- The two WhatsApp login screenshots were removed from the repo root. They are in the system trash and were never committed, so no history rewrite is needed.
- The stale `.playwright-mcp/` files (Oct 22) are untracked; they are still on disk.
- `.gitignore` now covers root images, `.env.*` (except `.env.example`), credential files, `*.local.json` and `.claude/worktrees/`.

## Verification (19 Nov 2026, local)

| Check | Result |
|---|---|
| `pnpm check` (typecheck, lint, unit) | 21/21 tasks green after the final fixes |
| API unit tests | 286 passed. New: normaliser (6), leak and static no-client checks (6), plus routes.spec pins for 13 routes |
| API e2e `flight-builder.e2e.ts` (8) and `flight-builder-http.e2e.ts` (7) | pass. They cover FEED/STAFF retirement, STAFF winning duplicates, freshness STALE/EXPIRED, the gate, the BLOCKED sync with no fetch, customer leak checks, no payment/invoice/reservation on a CATALOG request, the 404 for a non-owner, and the absence of credentials from the views and audit |
| API e2e `catalog*`, `services-catalog`, `security`, `hardening` | pass. `catalog-aviation-edge.e2e.ts` (peer work) skipped in a batch run and passes 21/21 alone |
| Contracts (43), domain flight-builder (17) | pass. The quota per-booking calculation was fixed during verification (it compared total hits with per-booking thresholds) |
| Playwright web `flight-builder.spec.ts` (en, fa), console `flight-builder.spec.ts` | pass |
| Playwright web `price-leak.spec.ts` | FAILS. The crawl waits for FAKE search result cards for THR→LON 2026-12-12, but search is catalog-backed and that slot has no data locally. Not caused by this stage (INFERRED); owed a fixture fix |
| Browser walk-through | Customer details (en, fa RTL), class selection, admin options, usage, request staff panel and Developer Panel gate all checked by hand |

Local demo data, all labelled TEST FIXTURE:
- result `01a1f4bb-88be-70fa-8723-9b9908b6e763` (TK1999 IST→LHR, 25 Nov; it expires after the 24 Nov deadline)
- request `UT-F-51B514`
- one MANUAL usage observation (2 bookings, 7 hits)
- one BLOCKED run
- a synthetic phone identity on the demo customer

The observation table is append-only, so the test observation stays.

## BLOCKED and owed
- Automated FB access: written permission from Amadeus (Q7), plus an adapter ADR. Until then the gate stays shut.
- Q8 (what happens at the limit), Q9 (whether prices include the proFee), and Q10 (whether customers may see FB availability; the owner chose to show it, ADR-0037 D4).
- The RESERVED status label still reads "Awaiting payment" in default config. The owner can relabel it for this no-payment flow.
- The `price-leak.spec.ts` fixture (above).

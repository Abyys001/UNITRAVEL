# STAGE-34 · Shipping management with manual couriers (ADR-0047)

Owner brief 19 Nov 2026 ("complete international postage & shipping management system", pasted; truncated at section 9). Owner decisions the same evening: **no courier API integrations, use the manual courier**; **staff-priced** (booklet request-and-quote unchanged).

## Built
- Consignments (`cargo_consignments`, SH-000001): book with a manual courier (active, compliance-cleared partner; outbound must serve the lane/service), service level, tracked/signed, courier tracking number + link, ship date, ETA, courier cost, courier label PDF upload (INTERNAL, virus-scanned), dispatch, cancel, returns. Never changes the request state. Console: shipment page → "Courier consignments".
- Customs review (`cargo_customs_reviews`): export reason, incoterm, duties payer, invoice number, approve; approval voided when declared items change; international outbound dispatch needs it. Commercial + pro-forma invoice PDFs.
- Pricing: rate cards gain markup % and fixed margin; `cargo_customer_rates` (discount / own markup per customer, lane, service). Calculator shows courier cost, customer price and profit; optional customer.
- Shipping dashboard `/cargo/dashboard`: KPIs, revenue/cost/profit per currency, daily small-multiple charts with table view, consignments by courier, booked-not-dispatched list, date range.
- Customer: `/shipments` shows dispatched couriers and their tracking links (never cost).
- Migration `0038_cargo_consignments.sql`; no new permissions.

## Not built (owner decision or out of scope)
- Courier APIs, live courier rates, courier-generated labels, webhooks (ADR-0047 D1).
- Instant customer prices (staff-priced).
- Brief sections after 9 (paste truncated).

## Verification (OBSERVED, staging 19 Nov 22:3x)
- tsc clean: db, contracts, i18n, api, console, web. Routes test 21/21.
- Migration applied (sequence created, 0 consignments); new pages 200 (`/cargo/dashboard`, `/cargo/calculator`, web `/en/shipments`); new endpoints 401 without a session; no API errors after restart.
- NOT run: signed-in flows (no staff login), PDFs on a real request, e2e specs. Backup `/root/backups/unitravel-staging-2026-11-19-2228.dump`.

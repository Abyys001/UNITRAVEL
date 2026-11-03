# Plan: flights → request → invoice (parallel build contract, reconciled)

Status: **PROPOSED, awaiting owner approval.** Date: 2 Nov 2026. Stage: STAGE-22 is taken by the Apify work (session apify-google-flights-source); the remaining streams get the next free stage number when approved.

Gap status per contract item (BUILT / PARTIAL / MISSING, file:line) is kept separately by session unitravel-ed in `docs/stages/GAP-flights-request-invoice.md`; this file is the plan.

Input: the "Uni Travel — Parallel Build Contract (Flights → Request → Invoice)" pasted by the owner on 2 Nov 2026 (hereafter "the contract"), ADR-0029 (Apify Google Flights, accepted 2 Nov 2026), and a read-only map of the existing code.

## 1. Finding: most of the contract already exists

The contract assumes an empty repo. It isn't one. Building it as written would duplicate modules, add a second request state machine (rule 4) and overwrite `packages/contracts/src/common.ts`. This plan keeps the contract's **product flow and rules** and maps them onto what exists. (OBSERVED unless marked.)

| Contract asks for | Already in the repo | Gap |
|---|---|---|
| Provider adapter, cache, budget | `suppliers/adapter.ts:45` `FlightSupplierAdapter`; FAKE/Duffel/Amadeus/Manual adapters; Redis leg cache `search.service.ts:133`; daily budget, RPS limit and concurrency cap `suppliers.service.ts:85,159` | Apify adapter (ADR-0029); single-flight lock in search (only `live-flights` has one) |
| `flight_searches` / `flight_results` | `searches`, `search_results`, `offer_snapshots` (`db/schema/suppliers.ts`) | none |
| `flight_result_pricing` (separate table) | price removed for customers by projection `search/customer-projection.ts:8` (ADR-0004); leak test `serialisers.spec.ts:14` | Apify staff-only fields (booking token, Google URL, price level, typical range) need a home; contract's forbidden-key list is not fully covered by the test |
| Encrypted credentials, hot reload | `provider_credentials` + `MASTER_ENCRYPTION_KEY`, write-only Developer Panel `dev-providers.controller.ts:62`, read per call | none (contract's `CREDENTIALS_MASTER_KEY` = existing `MASTER_ENCRYPTION_KEY`) |
| Airport autocomplete | `GET /v1/locations?q=` `reference.controller.ts:14` | none |
| Admin flight search + revalidate | `/v1/admin/flight-searches` and `POST admin/itineraries/:id/price-check` (`pricing.read.internal`) | revalidate response shape `{stillListed, priceChanged, old, new, fetchedAt}` |
| Request state machine (contract §5) | `packages/domain/src/flight-request.ts` (booklet ch. 20.4, ADR-0003): SUBMITTED → COMPLIANCE_HOLD/NEW → IN_REVIEW → QUOTED → ACCEPTED → RESERVED → TICKETED → COMPLETED | none; map contract states (§3 below) |
| `flight_request_events` | `request_status_history`, `audit_log`, `outbox_events`, all written in one transaction `requests.service.ts:231` | none |
| External booking record | `reservations` (6-char PNR, deadline) + `tickets` (13-digit) via `bookings.service.ts:55,250` | external panel reference and free-text note; PNR optional |
| Services catalogue | fixed enum `SERVICE_REQUEST_TYPES` and fixed `INVOICE_LINE_TYPES`; `service_requests` not linked to flight requests | **new**: catalogue table, attach to request, customer "interested in" ticks |
| Invoices | `invoices`, `invoice_lines`, `invoice_status_history` in minor units; draft from quote `POST v1/admin/requests/:ref/invoices`; issue and cancel; customer view hides DRAFT and returns 404 to non-owners (`invoices.service.ts:428,465`) | no VOID/UNCOLLECTIBLE states (CANCELLED covers void) |
| Stripe | Embedded Checkout on our own payment page (STAGE-11), signed webhook `v1/webhooks/stripe`, idempotent `stripe_events`, 10-minute reconcile job, flag `payments.online.enabled` (default false), live mode BLOCKED | contract wants the Stripe **Invoices** API (`send_invoice`, hosted URL, PDF), see decision D2 |
| Offline invoice path | `payment_records` + `POST admin/invoices/:id/payments` (manual recording) | bank-transfer instructions in issue email (check template) |
| Email | outbox → `notification-router.ts` → DB templates en/fa (`invoice.issued`, `payment.requested`, `invoice.paid`); SMTP/Brevo from Developer Panel | none |
| Events (contract §7) | outbox events, not EventEmitter (`outbox.dispatcher.ts:19`) | none; use outbox names, no `packages/contracts/events.ts` |
| ATOL order | `atolMode: PAY_ON_TICKETING` (`defaults.ts:125`); tickets require PAID (ADR-0003 F8) | none; answers contract §10.4: PAID before ticketed |

## 2. Owner decisions

| # | Decision | Recommendation (default if you say nothing) |
|---|---|---|
| D1 | Rebase the contract on existing modules, or build parallel modules as written? | **Rebase.** Parallel modules break rule 4 and ADR-0003 and double the surface. |
| D2 | Stripe Invoices API (hosted invoice + PDF, Stripe sends the email) vs the existing Embedded Checkout on our own payment page | **Keep Checkout**, the deliberate choice in ADR-0028 D7 (single-use sessions); switching would need a new ADR. It is built, tested and keeps the link in our app; our PDF already exists (`bookings.service.ts:357`, invoice documents). The "payment link" in the email is our payment page. Revisit only if you need Stripe's dunning or tax features. |
| D3 | Contract's `payments.stripe.enabled` | Use the existing **`payments.online.enabled`** (default false). Live mode stays BLOCKED (D-03, STAGE-0) until counsel answers the Iran-customer question. |
| D4 | DB split for prices (contract rule 1) | Keep the ADR-0004 projection + leak test; STAGE-22 keeps Apify staff-only fields off customer DTOs and adds them to the leak test. A full split of the price columns is a large migration with no added protection over the projection test. |
| D5 | Invoice VOID / UNCOLLECTIBLE | Map **void → CANCELLED** (existing). UNCOLLECTIBLE only matters with the Stripe Invoices API; skip under D2. |
| D6 | Can the customer-facing quote step be skipped (contract goes request → invoice directly)? | **No.** Rule 3 + ADR-0029 A3: UNKNOWN baggage/conditions block sending a quote; staff confirm in the external panel, then send a quote; the invoice comes from the accepted quote. The quote is the admin's "price + attached services" screen the contract describes. |

## 3. Contract state → existing state

| Contract | Existing (`flight-request.ts`) |
|---|---|
| SUBMITTED / COMPLIANCE_HOLD | SUBMITTED / COMPLIANCE_HOLD (then NEW) |
| IN_REVIEW | NEW, IN_REVIEW, AWAITING_CUSTOMER |
| QUOTING | IN_REVIEW with draft quote; QUOTED once sent |
| INVOICED | ACCEPTED + invoice ISSUED |
| PAID | ACCEPTED + invoice PAID (payment status, not a request state; rule 3) |
| BOOKED_EXTERNAL | RESERVED (external ref/PNR) → TICKETED (ticket numbers) |
| COMPLETED / CANCELLED / EXPIRED | same names; plus DECLINED |

No new states. Customer timeline is the existing customer serialiser over `request_status_history`.

## 4. Work, by stream (ownership kept, paths mapped)

Peers share one tree, ports and DB (no worktrees in use). Each stream touches only the files listed; shared files (`permissions.ts`, `openapi.json`, `en.ts`/`fa.ts`, `serialisers.spec.ts`) are edited **append-only** and merged by E.

### A. Flight data (ADR-0029). `apps/api/src/modules/suppliers/**`, `search/**`
Owned by session **unitravel-37** (author of ADR-0029), stage number TBD by that session. The items below are the contract's requirements for review against that work, not a separate build. That session confirmed on 2 Nov 2026 that its brief covers: the single-flight lock (SET NX in its Apify flight-data service, not in `search.service.ts`); staff-only fields kept off customer DTOs, with those keys added to `serialisers.spec.ts`; the recheck result `{stillListed, priceChanged, old, new, fetchedAt}`; and watchlist gateways stored as metering config. Its migration adds `providers.metering` and a `provider_runs` table.
1. `adapters/apify-google-flights.adapter.ts`: implements `FlightSupplierAdapter` (search, price-by-re-search); normalises to `NormalisedOffer`; local time + `tz` from reference data; drops rows with unknown airport or null price; brand/baggage/conditions always UNKNOWN; `source.provider = apify-google-flights`, provenance "indicative". Add `apify-google-flights` to `ProviderId` (`contracts/src/enums.ts:104`).
2. HTTP client to `api.apify.com/v2` only, `Authorization: Bearer` from `provider_credentials`; 401/403 marks credential invalid; every run sends `maxResults` and `maxTotalChargeUsd`.
3. Single-flight Redis/Valkey lock per cache key in `search.service.ts` (generic, benefits all providers); cache TTL 3 h for this provider.
4. Budget pools (customer / prewarm / staff, hourly customer cap) as config keys in `contracts/src/config.ts` + Developer Panel; daily reconcile against `GET /v2/users/me/limits` as a BullMQ job.
5. Staff-only fields returned only under `pricing.read.internal` (D4).
6. Revalidate: extend `price-check` response to `{stillListed, priceChanged, old, new, fetchedAt}`.
7. Fixtures + mocked HTTP; one manual smoke script capped at $0.02. CI never calls Apify.
8. Watchlist/prewarm routes (contract §10.3: VAN, ERZ, EVN gateways, Türkiye/Gulf → Europe) as config data, admin-editable. Iran-origin lanes stay disabled (ADR-0029 A10).

### B. Customer web. `apps/web/**`
1. Results card: "updated N minutes ago", "schedules from public listings; our team confirms availability and price" (en/fa, ADR-0029 A11), "separate tickets" label.
2. Request form: optional "also interested in" ticks from the public services catalogue.
3. Customer requests and invoices pages exist; check that they show issued invoice, payment page link and PDF. No new price display before a sent quote.

### C. Requests + services catalogue. `requests/**`, new `services-catalog/**`
1. `service_catalog_items` (code, en/fa name and description, line type, default price in minor units + currency, `showPriceToCustomer` default false, active). Staff CRUD under new permission `service_catalog.manage`.
2. `request_service_interests` (customer ticks at submit) and quote options carry catalogue lines → existing quote → invoice line pipeline. Extend `INVOICE_LINE_TYPES` only if a catalogue item doesn't fit (`OTHER` + label otherwise).
3. `reservations`: add `external_reference` and `note`; allow PNR null when only an external panel ref exists. **Changes a booklet guard (6-char PNR required): ADR-0030 needed.**
4. `GET /v1/services-catalog` public (names/descriptions only; price only when flagged).
5. Console: catalogue CRUD page; "attach services" in the quote editor; external booking fields in the reservation panel.

### D. Invoices, payments, email. `invoices/**`, `payments/**`, `notifications/**`
1. Under D2 nothing structural. Add: bank-transfer instructions (config text, en/fa) to the `invoice.issued` email when `payments.online.enabled=false`.
2. `invoice.payment_failed` / `checkout.session.async_payment_failed` → keep ISSUED and notify (check: `async_payment_failed` already handled at `payments.service.ts:264`).
3. Daily invoice/Stripe drift report (the 10-minute session reconcile already exists; add a daily summary only if wanted).

### E. Integration
1. Single Drizzle migration (after STAGE-22's own) for: `service_catalog_items`, `request_service_interests`, `reservations.external_reference/note`, budget config rows.
2. Extend `serialisers.spec.ts` forbidden keys with the contract's list: `priceLevel`, `typicalPrice*`, `bookingToken`, `googleFlightsUrl`, `bookingOptions`, `bookingUrl`, `totalPrice`, `cheapestReturn`, `priceNote`; also scan the built web HTML/JS for them.
3. e2e: FAKE + Apify fixture search → request with interests → compliance hold for an Iranian airport → quote with catalogue lines (blocked while UNKNOWN until staff confirm) → accept → invoice issue (offline) → record payment → reservation with external ref → tickets.
4. Permission matrix + fail-closed route table updated; OpenAPI regenerated; en/fa strings.
5. Stage verification record (next free number); `docs/build/STREAM_<X>_REPORT.md` per stream; DPIA entry (Apify as processor of search parameters); STAGE-0 entry (counsel on Google terms).

## 5. Order

A1–A3 and C1–C2 can run in parallel (no shared files beyond append-only ones). D1–D2 is small and independent. B starts after A's offer shape and C's public catalogue endpoint exist. E runs last. Estimated new tables outside STAGE-22: 2; new ADR: 0030 (external booking reference without PNR).

## 6. Out of scope here
Cargo; Duffel/Amadeus enablement; Stripe live mode; mobile (ADR-0026 paused).

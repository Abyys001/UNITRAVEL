# Gap check: flights → request → invoice (owner prompts A–E)

Date: 2 Nov 2026. Read-only check of the owner's five-stream prompt pack against the code and against ADR-0028 (direct invoices, Stripe Checkout) and ADR-0029 (Apify Google Flights). No code was changed. This is not a stage record and takes no stage number. The plan that links here is `docs/build/PLAN-flights-request-invoice.md`.

Ownership: the Apify items (A1–A6, A9) are **planned under ADR-0029, stage TBD**, owned by the session implementing ADR-0029. The stage number is the owner's call (rule 9).

Main finding: the pipeline from request to quote, invoice and Stripe Checkout already exists (stages 3, 10, 11, 21). Prompts C and D mostly describe things that are already built. The real gaps are the Apify provider and its cost controls, plus some UI and test extras. Prompt D's Stripe Invoicing design (hosted invoice URL) conflicts with ADR-0028 D7, which chose Checkout. Changing that needs a new ADR.

Item ids follow the prompts: A = flight data, B = customer web, C = requests/admin, D = invoicing/Stripe/email, E = integration.

## Status

| # | Status | Evidence |
|---|---|---|
| A1 credentials | PARTIAL | OBSERVED: `suppliers.service.ts` `setCredentials` (envelope encryption, `core/crypto.ts`), write-only `view()`, audit `provider.credentials_rotated` (`dev-providers.controller.ts:67`), `POST :id/test`, Valkey `provider.config_changed` reload. Missing: `apify-google-flights` in `ProviderId` (`packages/contracts/src/enums.ts:104`) and seed; last-4 display; stop calls on 401/403 (see conflicts). |
| A2 Apify adapter | MISSING | OBSERVED: only duffel, amadeus, fake and manual adapters. |
| A3 cache/single-flight/budget | PARTIAL | OBSERVED: leg cache and daily call-count budget per provider in `search.service.ts`. Missing: single-flight lock, USD pools with staff reserve, usage ledger, hourly customer cap, daily `/v2/users/me/limits` reconciliation, full cache key (maxStops, airlines, currency, market). |
| A4 price confidentiality | BUILT, Apify fields missing | OBSERVED: `search/customer-projection.ts`; leak tests in `apps/api/src/routes.spec.ts:21`, `test/stage3.e2e.ts`, `test/phase-j.e2e.ts:469`. `bookingToken`, `googleFlightsUrl` and price level are not modelled. |
| A5 revalidation | BUILT | OBSERVED: `priceCheck`/`revalidate` → CONFIRMED / PRICE_CHANGED / UNAVAILABLE / OFFER_EXPIRED; `/v1/admin/itineraries/:id/price-check`. INFERRED: Apify "not found" maps to UNAVAILABLE. |
| A6 watchlist prewarm | PARTIAL | OBSERVED: BullMQ `listings.warm-flights` over the editable `listings.flightRoutes` (`listings.service.ts:68,111`). One date per route, no prewarm pool, feeds listings rather than the search cache. |
| A7 self-transfer builder | BUILT | OBSERVED: `packages/engine/src/build.ts`, `plan.ts`; `selfTransferMinMin`/`maxLayoverMin` in `contracts/src/config.ts`; HUBS/ENGINE_RULES editor in the Developer Panel. |
| A8 Iran compliance | BUILT, one check owed | OBSERVED: seed blocks Iran-registered carriers (`packages/db/src/seed/index.ts:96-97`); `engine/src/filter.ts:33` blockedAirports; LANE `IR:*` REVIEW. UNKNOWN: whether Iran-origin flight searches return no customer results (ADR-0029 A10); the lane policy looks cargo-only. |
| A9 admin search + settings | PARTIAL | OBSERVED: `console/src/app/admin/(app)/search` shows prices. Missing: cost estimate; budget/TTL/maxResults/watchlist settings. |
| A10 airport autocomplete | BUILT, being changed | OBSERVED: `reference.controller.ts` `GET locations?q`; uncommitted edits in progress. |
| B1 search + results | PARTIAL | OBSERVED: polling in `web/.../search/page.tsx`; `itinerary-view.tsx` has aircraft, operated-by, layovers, local times, self-transfer. Missing: legroom, CO₂, "updated N min ago", client-side filters and sort. |
| B2 empty → request | BUILT | OBSERVED: `/request/new?manual=` from empty or failed search. |
| B3 request form | PARTIAL | OBSERVED: travellers, contact, `sign-in?next=` keeps the selection. Missing: "also interested in" services (needs C3). |
| B4 customer panel | BUILT | INFERRED: `requests/[ref]`, `billing/[number]`, `status-timeline.tsx`; DRAFT excluded at `invoices.service.ts:428` (OBSERVED). |
| B5 front-end leak test | PARTIAL | OBSERVED: `web/e2e/customer.spec.ts:27-29` checks visible text only; no DOM attribute or RSC payload scan. |
| B6 i18n | PARTIAL | OBSERVED: en/fa catalogues, Jalali in `packages/i18n/src/calendar.ts`. Missing: ADR-0029 A11 disclosure text. |
| C1 request state machine | BUILT | OBSERVED: `packages/domain/src/flight-request.ts`, `request_status_history`, `request_notes`, `assigneeUserId`. |
| C2 snapshot + compliance hold | BUILT | OBSERVED: `offer_snapshots`; SUBMITTED → COMPLIANCE_HOLD. |
| C3 service catalogue | MISSING | OBSERVED: only `service_requests` (`packages/db/src/schema/services.ts:16`); no priced catalogue with en/fa names or per-passenger pricing. |
| C4 external booking record | BUILT | OBSERVED: `reservations.recordLocator`, `tickets.ticketNumber`, recordedBy. |
| C5 admin inbox/detail | BUILT | INFERRED: re-check button on admin request detail; SLA in `queue-insights.tsx`. |
| C6 invoice editor | BUILT | OBSERVED: `console/admin/(app)/invoices/[id]`; draft/issue/cancel; offline payment per ADR-0028 D9. |
| D1 invoices | BUILT | OBSERVED: `invoices`, `invoice_lines`, `document_sequences`, `domain/invoice.ts`. |
| D2 Stripe | BUILT (Checkout) | OBSERVED: `stripe.adapter.ts` `constructEvent` and idempotency keys; `stripe_events`; `payments.service.ts` handles checkout.session.*, charge.refunded, charge.dispute.*. Prompt D's Stripe Invoicing would reverse ADR-0028 D7. |
| D3 offline payment | BUILT | OBSERVED: `payment_records.receivedAt` separate from recorded/verified. |
| D4 reconciliation | PARTIAL | OBSERVED: 10-minute sweep of overdue sessions plus per-session timers; no daily full sweep. |
| D5 email | BUILT | OBSERVED: SMTP, Brevo with Mailjet fallback (`notifications/channels.ts`); `outbox_events` retries; `notification_templates`; PDF on invoice.issued and payment.requested. UNKNOWN: which en/fa templates are seeded. |
| D6 customer invoices | BUILT | OBSERVED: `invoices.service.ts:428`. |
| E1 chained e2e | PARTIAL | OBSERVED: `customer.spec.ts` (search → request → tracking) and `payment.spec.ts` (FAKE invoice payment) are separate tests; CI uses FAKE adapters only. |

## Gaps in dependency order

1. A1: `apify-google-flights` provider id and seed row; stop calls on 401/403; last-4 display. *(ADR-0029, stage TBD)*
2. A2: Apify adapter with maxResults 15/30, maxTotalChargeUsd, normalisation per ADR-0029 A4, recorded fixtures behind mocked HTTP, $0.02 manual smoke script. *(ADR-0029)*
3. A3: cost-control service: full cache key, single-flight lock, USD pools and staff reserve, ledger, hourly cap, daily limits reconciliation. *(ADR-0029)*
4. A4: staff-only Apify fields behind `pricing.read.internal`; extend the leak tests to cover them. *(ADR-0029)*
5. A9: Developer Panel settings for budget, TTL, maxResults and watchlist; cost estimate on the admin search page. *(ADR-0029)*
6. A6: move prewarm onto the prewarm pool and the search cache. *(ADR-0029)*
7. A8: test that Iran-origin flight searches give no customer results (ADR-0029 A10).
8. B1: "updated N min ago", legroom, CO₂, filters and sort.
9. B6: ADR-0029 A11 disclosure in en and fa.
10. B5: front-end payload leak scan (DOM attributes, RSC payload, JS chunks).
11. C3 then B3: priced service catalogue, then "also interested in" on the request form.
12. D4: daily full Stripe reconciliation, only if the owner still wants it beyond the 10-minute sweep.
13. E1: one chained e2e from search to payment.

## Conflicts with accepted ADRs

- **ADR-0029 A8:** on 401/403 the code only raises an "AUTH" health event (`suppliers.service.ts:225`) and keeps calling. The ADR requires marking the credential invalid and stopping calls.
- **ADR-0029 A6:** the current cache key and the per-day call-count budget do not meet the required key fields or the USD pool model. Running Apify through the current search path unchanged would break A6.
- **ADR-0028 D7:** Prompt D's Stripe Invoicing (hosted_invoice_url, invoice.paid webhooks) reverses the Checkout decision. Keep Checkout, or write a new ADR.
- **ADR-0028 D4:** catalogue services must map onto the fixed invoice line-type enum, and flight lines stay on the request path.

## Owner decisions

- Stage number for the ADR-0029 work (rule 9).
- Whether C3 (service catalogue) and D4 (daily reconciliation) are wanted.
- Counsel review of ADR-0029 is still owed (counsel-owed, UNKNOWN).

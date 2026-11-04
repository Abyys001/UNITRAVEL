# Master plan: flights → request → services → invoice → payment

Status: **APPROVED by the owner, 2 Nov 2026** (all defaults in §6 accepted: `BAGGAGE` line type, daily drift sweep report-only). Stage: **STAGE-26** (built as STAGE-23; renumbered at merge on 4 Nov 2026 because 23–25 were taken by visa, catalog and FlightAPI). Session: unitravel-5d.

Owner choice (2 Nov 2026): option (a). Build on existing modules per `docs/build/PLAN-flights-request-invoice.md` (D1–D6 defaults accepted) and wait for Stream A (session `apify-google-flights-source`, ADR-0029) to commit before branching. This file is the execution plan for that plan; it does not repeat its rationale.

Inputs not in the repo (BLOCKED): `docs/build/PARALLEL_BUILD_CONTRACT.md`, `docs/integrations/apify-google-flights.md`, Apify MCP. Contract section numbers below are as cited in the reconciled plan; the reconciled plan is taken as a faithful capture of the contract.

## 1. Repo findings and path mapping (OBSERVED)

| Contract item | Real location |
|---|---|
| Auth, roles, OTP, permissions | `apps/api/src/modules/identity`, `access`; `packages/contracts/src/permissions.ts`; `RequirePermission()` `apps/api/src/core/http/decorators.ts:21`; route table `apps/api/src/routes.spec.ts`, matrix `apps/api/test/matrix.e2e.ts` |
| Credentials (encrypted, write-only, hot reload) | `provider_credentials`, `core/crypto.ts`, `suppliers/dev-providers.controller.ts:62` (Developer Panel). Contract `CREDENTIALS_MASTER_KEY` = `MASTER_ENCRYPTION_KEY`. No new `CredentialsService` interface. |
| Flight search, cache, budget, revalidate | `apps/api/src/modules/search`, `suppliers` (**Stream A, peer session**) |
| Price-leak guard | `search/customer-projection.ts` (ADR-0004), `apps/api/src/serialisers.spec.ts`, `routes.spec.ts:21` |
| Request state machine + events | `packages/domain/src/flight-request.ts` (ADR-0003), `request_status_history`, `outbox_events` (`platform/outbox.service.ts`) |
| Reservation / ticket (external booking) | `reservations` `packages/db/src/schema/requests.ts:181` (`recordLocator varchar(6) NOT NULL`), contract `requests.ts:141` regex, `bookings.service.ts` |
| Services | fixed enums `SERVICE_REQUEST_TYPES` `contracts/src/services.ts:10`, `INVOICE_LINE_TYPES` `contracts/src/invoices.ts:21`; no catalogue |
| Invoices, Stripe, offline pay | `modules/invoices`, `modules/payments` (Checkout, ADR-0028), `payments.online.enabled` |
| Email | outbox → `notifications/notification-router.ts` → DB templates en/fa; SMTP/Brevo via Developer Panel |
| Customer web | `apps/web/src/app/[locale]/{search,itinerary,request/new,requests,billing}` |
| Console | `apps/console/src/app/admin/(app)/{requests/[ref],invoices,services,search}` |
| i18n | `packages/i18n/src/{en,fa}.ts` |
| Tests | Vitest unit/e2e under `apps/api/test/*.e2e.ts`; Playwright `apps/web/e2e` |

Contract → repo mismatches resolved by D1–D6 of the reconciled plan: no new state machine, no `events.ts`, no `common.ts` rewrite, no pricing table, Checkout instead of Stripe Invoices, `payments.online.enabled` instead of `payments.stripe.enabled`, quote step kept.

## 2. Foundations (Phase 2, me, after Stream A commits)

Branch `feat/flights-requests-invoices` from Stream A's commit (worktree, not a checkout of the shared tree).

1. `packages/contracts/src/service-catalog.ts`: `ServiceCatalogItem`, create/update bodies, public projection (no price unless `showPriceToCustomer`), `RequestServiceInterest`. Export from `index.ts`.
2. `packages/contracts/src/permissions.ts`: add `service_catalog.manage` (append-only).
3. `packages/contracts/src/requests.ts`: reservation body accepts `recordLocator` **or** `externalReference` (+ optional `note`); flight-request submit body gets optional `serviceInterests: string[]` (catalogue codes).
4. ADR-0030: external booking reference without PNR (changes the 6-char PNR guard).
5. Shared leak helper `apps/api/test/leak.ts`: recursive forbidden-key scanner (contract §1 list plus Apify keys: `priceLevel`, `typicalPrice*`, `bookingToken`, `googleFlightsUrl`, `bookingOptions`, `bookingUrl`, `totalPrice`, `cheapestReturn`, `priceNote`, plus existing ADR-0004 keys). `serialisers.spec.ts` switches to it.
6. Commit. Stream worktrees branch from this commit.

## 3. Streams

Stream A is not run by me. B, C, D run as parallel subagents in worktrees from the Phase 2 commit. Shared files (`openapi.json`, `en.ts`/`fa.ts`, `permissions.ts`) are append-only; conflicts resolved at merge.

### A. Flight data (peer session, ADR-0029)
Committed on main as `bb34763` (STAGE-22 backend; migration `0020_apify_google_flights.sql`, not yet applied to the shared DB). Recheck is async: `POST /v1/admin/itineraries/:id/recheck` → 202 `{jobId}`, then `GET …/recheck/:jobId` → `{status, result:{stillListed, priceChanged, old, new, fetchedAt, components[]}}` (types in `contracts/src/search.ts`). Metering is `ProviderMetering` (`contracts/src/dev.ts`) in `providers.metering`. Still owned by the A session: console/web UI for results notices and the indicative disclosure, the prewarm job, `docs/stages/STAGE-22.md`. **Stream B therefore drops the results-card disclosure/"updated N min ago" item.**
Review only, at merge: Apify adapter with `maxResults` + `maxTotalChargeUsd` on every run; single-flight lock; budget pools with staff reserve; staff-only fields off customer DTOs and in the leak helper; price-check `{stillListed, priceChanged, old, new, fetchedAt}`; watchlist gateways (VAN, ERZ, EVN, IKA→IST) as data; Iran carriers excluded, Iranian-airport itineraries → compliance; fixtures only in CI.

### C. Services catalogue, request interests, external booking
- DB: `packages/db/src/schema/services.ts` add `service_catalog_items` (id, code unique, `nameEn`, `nameFa`, `descriptionEn/Fa`, `lineType` → `INVOICE_LINE_TYPES`, `defaultPriceMinor` int, `currency` char(3), `perPassenger` bool, `showPriceToCustomer` bool default false, `active`, timestamptz audit cols) and `request_service_interests` (requestId FK, catalogueItemId FK, unique pair). `requests.ts`: `reservations.recordLocator` nullable, add `externalReference varchar(64)`, `note text`, CHECK one of the two present.
- API: new `apps/api/src/modules/services-catalog/` (controller, service, module). `GET /v1/services-catalog` (public), `GET/POST/PATCH /v1/admin/services-catalog[/:id]` (`service_catalog.manage`, audited). `requests.service.ts` stores interests on submit (same transaction). Quote editor input accepts catalogue lines with overridable price → existing quote → invoice line pipeline. `bookings.service.ts` accepts external ref.
- Console: `admin/(app)/services/catalog` CRUD page; "attach services" in quote editor on `requests/[ref]`; interests shown on request detail; external ref + note in reservation panel.
- Tests: domain/unit for catalogue validation; `apps/api/test/services-catalog.e2e.ts` (CRUD authz, public projection with leak helper, interests on submit, quote with catalogue line → invoice line, reservation with external ref only); route table + permission matrix rows.

### D. Invoices, payments, email (small)
- `invoice.issued` template en/fa: bank-transfer instructions block from config text (new config key `payments.offlineInstructions` en/fa) when `payments.online.enabled=false`.
- Confirm `checkout.session.async_payment_failed` keeps invoice ISSUED and emits `payment.failed` notification; add the template if missing.
- Daily drift sweep job (BullMQ) comparing ISSUED invoices with open sessions against Stripe; only report, no state change without a webhook.
- Tests: `apps/api/test/stage-next-payments.e2e.ts`: offline flow (issue → email captured with instructions → mark paid → PAID); duplicate and out-of-order webhook replay; failed payment; email provider down → outbox retry.

### B. Customer web
- Results card: "updated N min ago", ADR-0029 A11 disclosure ("schedules from public listings; our team confirms availability and price"), "separate tickets" label (en/fa).
- `request/new`: "also interested in" ticks from `GET /v1/services-catalog`.
- `requests/[ref]` and `billing/[number]`: confirm issued invoice lines, total, status, Pay (our payment page) and PDF.
- Playwright `apps/web/e2e/price-leak.spec.ts`: crawl customer pages logged out/in; grep HTML, RSC payloads, JS chunks, network responses, console for the forbidden keys and `google.com/travel` URLs. Zero hits.
- Mobile widths and RTL screenshots for changed pages.

## 4. Merge order, migration, seed

Merge: A (already on base) → foundations → C → D → B. One Drizzle migration generated after merge (numbered after Stream A's migration, which is not fixed yet), hand-reviewed: FKs, unique indexes, integer minor units, timestamptz, CHECK on reservation ref. Run on a fresh DB. Seed (`packages/db/src/seed`): catalogue items (INSURANCE, CIP, BAGGAGE→OTHER, VISA, TRANSFER) with en/fa names, offline instructions config, Apify fixtures as cached searches (local only). Users and roles already seeded. Keys entered through the Developer Panel only.

## 5. Verification checklist (Phase 5)

1. Typecheck, lint, unit, API e2e green.
2. e2e with Apify fixtures and Stripe test mode (CLI webhooks): search → no prices → detail → sign in → request with interests → admin sees prices → revalidate → attach insurance → quote → accept → invoice → email captured → customer pays → webhook → PAID → reservation with external ref → ticketed.
3. Same with `payments.online.enabled=false`: offline invoice, mark paid.
4. Iranian-airport itinerary → COMPLIANCE_HOLD → staff clears.
5. Price-leak audit: helper on every customer endpoint + web crawl.
6. Cost audit (Stream A's tests, re-run): 200 concurrent identical searches → 1 provider call; budget exhaustion keeps the admin reserve.
7. Security: no secrets in logs, responses, job payloads, fixtures; admin routes reject customer/staff tokens; webhook signatures enforced.
8. Failure drills: Apify 401/408/run-failed/zero rows; duplicate/out-of-order webhooks; email down.
9. UX: mobile, RTL, loading/empty/error states, focus, contrast.

Outputs: `docs/build/STREAM_{B,C,D}_REPORT.md`, `docs/build/VERIFICATION_REPORT.md`, `docs/build/RUNBOOK.md`, stage record `docs/stages/STAGE-N.md`, DPIA entry (Apify as processor), STAGE-0 entry (counsel on Google terms). Push branch, open PR, do not merge.

## 6. Open questions for the owner

0. NEW (from Stream A): the `IR:*` lane policy is not applied by the flight engine, so Iran-origin flight searches are not blocked by lane; the Iran-origin test is skipped. Owner decision needed.

1. Stage number for this work (22 is Apify).
2. Contract and Apify docs: paste or save them, or confirm the reconciled plan is enough.
3. Baggage as a catalogue item: map to `OTHER` with a label, or add `BAGGAGE` to `INVOICE_LINE_TYPES`? Default: add `BAGGAGE` (one enum value, no migration of existing rows).
4. Daily drift sweep (D): wanted, or is the existing 10-minute reconcile enough? Default: build it, report only.

Owner decisions carried from contract §10 (defaults in force unless you say otherwise): Stripe online off (`payments.online.enabled=false`), live BLOCKED pending counsel; Google-based data as indicative only (ADR-0029, vs booklet D-10); thin Iran→Türkiye coverage via gateway routes as data, Iran-origin lanes disabled; PAID before ticketed (`PAY_ON_TICKETING`, ADR-0003 F8).

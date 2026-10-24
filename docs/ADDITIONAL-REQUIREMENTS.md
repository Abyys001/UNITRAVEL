# Additional requirements (23 Oct 2026): gap plan and owner decisions

Source: "Uni Travel — Additional Requirements: Gap Analysis and Plan" (23 Oct 2026), reviewed against commit 70dda65.
Stages 1–6 are built; this is a gap plan. Phases are tracked in `docs/PLAN.md`; each ends with a
`docs/stages/STAGE-N.md` verification record (A = 7, B = 8, E = 9, C = 10, D = 11, F = 12).

## Owner decisions (recorded 23 Oct 2026)

| # | Question | Decision | Status |
|---|---|---|---|
| 1 | Stripe vs D-03 | Build Stripe Embedded Checkout fully, **test mode only**, behind a flag that is off by default. Live mode waits on Stripe's written approval and counsel. Offline payment stays for everyone; an eligibility policy (compliance data) decides who is offered online payment. | DECIDED (owner); live go-live BLOCKED on Stripe + counsel |
| 2 | Price-hiding scope | Customers see **no amounts** on search results, itinerary detail, seat maps or price-check. Price weight is **removed from customer ranking** (neutral ordering). Customers see amounts only on sent quotes and issued invoices. | DECIDED (owner) |
| 3 | Design | **Audit and improve** the existing system in `docs/design/DESIGN.md`; no new visual direction. Build on the parallel brand overhaul ("Night flight", unitravels.co.uk brand: tokens in `packages/ui/src/styles.css`, components in `packages/ui/src/brand/`), not the earlier copper/Fraunces look. | DECIDED (owner) |
| 4 | Verification gate | VERIFIED traveller documents are required at **record_tickets**, not at quote acceptance. | DECIDED (owner) |
| 5 | Invoice particulars (company registration, VAT treatment, numbering format) | Configurable; values stay **UNKNOWN** until the accountant answers. Numbering uses a configurable prefix + yearly sequence. Live issuing of invoices is not blocked in local/test. | UNKNOWN (accountant) |
| 6 | Email vendor | Existing `EmailSender` (Mailpit locally). Brevo is listed but not contracted. Fallback when no verified email: SMS + in-app. | UNKNOWN (contract) |
| 7 | Passport-scan retention | Configurable retention period; default left UNKNOWN in the DPIA until set. | UNKNOWN (DPIA owner) |
| 8 | Mobile payment | Mobile opens the website payment page in the system browser; no Stripe keys in the app. | PROPOSED (plan default) |
| 9 | Residential address | Optional on the profile; required only when an invoice or a cargo request needs it. | PROPOSED (plan default) |

## Already done before the phases
- Supplier-price leak (23 Oct 2026): customer quote options no longer carry `supplierPrice`, `supplierFetchedAt`,
  `supplierExpiresAt` or `components`; customer snapshot no longer carries `priceAtSubmit`/`priceRevalidated`/`revalidatedAt`
  (`packages/contracts/src/requests.ts`, `apps/api/src/modules/requests/requests.service.ts` `quoteViews`/`snapshotView`).
  The serialiser property test now contaminates with these fields and includes a sent quote (`apps/api/src/serialisers.spec.ts`).

## Phase order
A first, then B, then E, then C, then D, then F (run sequentially: they share migrations, the permission
catalogue and the en/fa catalogues). D's go-live stays gated even when its code is done.

## Phase A — Price confidentiality (S)
- ADR-0004, the price-confidentiality deviation (records decision 2).
- Customer-only projections of search results, itinerary and seat maps with no amounts; neutral customer ranking.
- Price-check endpoint becomes staff-only.
- At submit, record the revalidated price on the snapshot for staff and never block the customer on a price change.
- New permissions: `pricing.read.internal` (cost, supplier price, margin), `pricing.write`,
  `commercial_document.issue` (only these staff can issue documents with prices). Staff search results show supplier
  totals only to holders of `pricing.read.internal`.
- Remove prices from the Flutter models and screens and the web pre-quote screens; update the contract test.
- Done when: the permission matrix covers the new permissions, and a customer response with any amount outside a sent
  quote or issued document fails the property test.

## Phase B — Identity, profile, passport, verification (L; reqs 4–7)
- ADR-0005, identity verification.
- Schema: address fields (line1, line2, city, postcode, country) on `customer_profiles`; on traveller documents
  `verificationStatus` (UNVERIFIED, SUBMITTED, VERIFIED, REJECTED, CORRECTION_REQUIRED), `customerConfirmedAt` and a
  hash of the confirmed values; new `verification_reviews` table (subject, decision, reason code and text, reviewer,
  value hash). A state machine in `packages/domain` with property tests.
- Material changes send a VERIFIED record back to SUBMITTED: passport number, names, date of birth, nationality,
  issuing country, expiry, or a replaced scan. A Persian-name edit does not.
- Passport scans: reuse the upload pipeline with a new PASSPORT_SCAN type; separate bucket with server-side encryption;
  strip image metadata; downloads require `customer.read.documents` and are audited (which also closes the general
  download hole: today any holder of `flight_request.read.any`/`cargo_request.read.any`/`compliance.case.read` downloads
  any document unaudited, `documents.controller.ts`); retention configurable (decision 7).
- Screens: web and mobile "My details" with review-then-confirm, and add-and-verify phone or email (API
  `POST /v1/me/identities` exists), also inline on the request form. Console: verification queue and side-by-side
  compare view (scan next to fields, audited reveal).
- Guard: VERIFIED documents required at `record_tickets` (decision 4).

## Phase E — Cargo tracking improvements (S–M; req. 1)
- Shipments section in navigation, overview and summary card.
- Visual timeline with en/fa event labels (no raw codes like DEPARTED).
- `estimatedDeliveryAt`, labelled as an estimate.
- Staff corrections as appended, audited events (never edit in place).
- `CargoTrackingPort` with a manual adapter and an external-event-ID column for deduplication, ready for partner APIs
  (PARTNER_API already exists as an event source value).

## Phase C — Quotations and invoices (M–L; req. 3)
- ADR-0006, commercial documents.
- A quotation is the existing sent quote plus a document number, a PDF and an email. An invoice is new: `invoices`,
  `invoice_lines`, `invoice_status_history`. Invoice amounts are fixed at issue; corrections are cancel and reissue.
- Invoice states: DRAFT → ISSUED → PAID | CANCELLED; PAID → REFUNDED (state machine in `packages/domain`).
- Under PAY_ON_TICKETING a flight invoice is issued only once same-day ticketing is confirmed and expires at the end
  of that day.
- Email through the notification system to the verified email with a sign-in-protected short link (`short_links`
  exists); falls back to SMS and in-app when no email is verified.
- Upgrade the PDF template; documents stay in English, matching the existing renderer. Particulars per decision 5.
- Screens: customer documents and billing area (web + mobile); Admin Panel list with history.
- Done when: e2e covers issue → email → open → cancel or expire.

## Phase D — Stripe Embedded Checkout (L; test mode only)
- ADR-0007, formally amending D-03 (decision 1).
- Server creates the Checkout Session with `ui_mode: "embedded_page"` and returns only the `client_secret`; the amount
  comes from the invoice, never the client. One reusable open session per invoice, with idempotency keys; session
  expiry no later than the invoice's.
- `POST /v1/webhooks/stripe` outside the auth guard: verifies the signature on the raw body; records each event in a
  new `stripe_events` table unique by event ID (duplicates are no-ops); handles `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`/`async_payment_failed`, `checkout.session.expired`, `charge.refunded`
  and disputes.
- Only verified events create `payment_records` (new method CARD_ONLINE) and move the invoice to PAID. The return page
  reads our database and never treats the redirect as proof of payment.
- Reconciliation job checks overdue sessions; amount or currency mismatches open a case.
- Developer Panel: write-only keys per mode through existing credential storage; switching test ↔ live requires
  step-up and owner approval (live stays disabled by flag); webhook URL, recent events, failures, health check.
- Admin Panel: payment status, payment-link resend, refund requests with four-eyes above the existing threshold.
- Clients: web CSP allows js.stripe.com; mobile opens the website payment page in the system browser.
- Eligibility policy stored as compliance data decides who is offered online payment.

## Phase F — Design and UX (M–L)
- Audit every major screen in both locales and record findings (`docs/design/`).
- One token source generating CSS variables and Dart tokens.
- Remove duplicate console and native components (native selects beside shared components, the console's own
  `ui.tsx`, separate Flutter `kit_ui` tokens).
- New patterns: request progress stepper, tracking timeline, document card, payment screens, verification badge,
  loading/empty/error states.
- Done when: Playwright snapshots, axe checks and Flutter golden tests pass on each major screen in en and fa, at
  desktop and mobile widths.

## Cross-cutting (every phase)
- Extend the route-table and permission-matrix tests.
- Audit actions for every staff decision: price set, document issued or cancelled, verification decided, refund,
  Stripe mode change.
- Update the DPIA (passport scans; Stripe and the email vendor as processors).
- Runbooks for Stripe webhook failure and refunds.

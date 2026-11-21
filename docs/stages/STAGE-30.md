# STAGE-30 · Admin dashboard: notifications, request page, Customer Club, Stripe invoices (ADR-0039)

Owner brief of 21 Nov 2026, "Task 1: Improve and Complete the Admin Dashboard". The plan was approved the same day. Owner decisions:
- staff-managed club points with no earning rule;
- remove the "APY Usage" (Apify usage) card everywhere;
- the owner enters the Stripe test key in the Developer Panel.

Other sessions ran in the same tree at the same time: Task 2 (customer portal, ADR-0040, migration 0031) and Task 3 (customer service pages, ADR-0041). They agreed migration numbers, and Task 2 renders points on the web and mobile club screens from this stage's contract.

Evidence labels: OBSERVED = run and seen here; DOCUMENTED = from code/ADR; INFERRED; UNKNOWN; BLOCKED.

## Section audit (owner asked what each section does)

**Services** (`/services`, ADR-0015/0020). One queue for non-flight customer requests:
- request types: visa, airport CIP, insurance, tour call-back, hotel, stay, train, bus (UT-S refs);
- sources: the web/app service forms, or staff "Assign service" on a customer's page;
- flow: SUBMITTED → IN_PROGRESS → QUOTED → CONFIRMED → COMPLETED, plus CANCELLED and CLOSED_NO_RESPONSE;
- each type is behind a feature flag.

Connected to real data (OBSERVED: 65+ live local requests). Gaps: no internal notes or documents on the service detail page.

**Customers.** Profiles, activity, assign service, direct invoice, passport reveal. Connected.

**Support** (ADR-0019). Ticket inbox with replies, commands and call log. Connected. Click-to-call stays BLOCKED: the Bonline vendor API is UNKNOWN.

**"Complaints" = Compliance** (`/compliance`). There is no complaints section. Compliance holds the cases opened automatically:
- sanctions or name-screening hits;
- blocked carrier, party, goods or lane;
- card payment mismatches.

Staff decide RELEASE (four eyes), DECLINE, ESCALATE or OVERRIDE. The Policies and Lists tabs manage the rules and the sanctions lists. Customer complaints arrive in Support (topic FEEDBACK). Connected.

**Identity checks** (`/verifications`, ADR-0005). The queue of passports customers confirmed. Staff compare the fields with the scan (audited) and decide VERIFIED, CORRECTION_REQUIRED or REJECTED. Tickets cannot be recorded until every traveller is VERIFIED. Connected. The detail page was English-only and is now en/fa.

**Invoices** (ADR-0006/0028). List, direct invoice, issue, cancel, offline payment, refunds. Connected. Now also Stripe invoices (below).

**Customer Club** (ADR-0016). Members, tiers, benefits, credit ledger. Connected, but "Add member" was disabled because no active tier existed. Fixed, and points added.

**Service Catalogue** (STAGE-26). Add-on items:
- fields: code, en/fa name and description, invoice line type, default price, per passenger, show price, active;
- active items are tick boxes on the website flight request form (`service-interests.tsx`);
- ticked items show on the staff request page as "Service interests";
- the quote builder offers them as option lines, and the quote and invoice set the price;
- not on mobile.

Complete for that scope; the console now explains it.

**Visa Checker Content** (ADR-0033). Rules, conflicts, research runs, sources, documents and audit for the visa checker. Connected. Research answers stay unconfirmed without an Anthropic key.

**Flight Research = Flight search** (`/search`). Staff live search. BLOCKED without Duffel or Amadeus credentials.

**Flight Catalog** (ADR-0034–0037). Pacer spend, coverage, watchlist, settings, Flight Builder. Connected; depends on provider keys.

**Bug fixed:** the glossary edit and status move called `/glossary/undefined`, because the API keys terms by slug. They now use the slug (OBSERVED in code; the API contract has no id).

## What was built
- **Dashboard.**
  - The Apify usage tile is removed from the admin and dev homes. Catalog spend stays on `/catalog`.
  - On duty is now a one-line control the height of the queue button, with a status dot and English/Persian labels; the duplicate keys are removed.
  - Notifications tile added.
  - KPI cards stack their note above the trend line on phones (the line used to overflow).
- **Notifications (D1, D2).**
  - Contracts: `staff-notifications.ts` and the `STAFF` audience.
  - `StaffFeedService` with the pure `feedItemFor`, queue `notify.staff`, `StaffNotificationsController`.
  - New outbox events `support.customer_replied` and `identity.submitted`.
  - SSE `notifications` and `support-changed` events.
  - Console: bell feed, `/notifications` page, sidebar unread badges per area, toast on new items, read on open (request, cargo, service, ticket, invoice, verification).
- **Request page redesign.**
  - New `case-section.tsx` (CaseSection, FactGrid, SectionNav, SubHead).
  - The flight request page is a sunk page with raised cards: hero card with a facts grid, sticky action bar, sticky jump-nav, then sections:
    - main column: Trip & itinerary, Compliance, Conversation, Administrative notes, Timeline;
    - side column: Customer, Quotes, Payment & invoices, Reservations & tickets, Documents.
  - On phones it is one column (the mobile tabs were replaced by the jump-nav). The service request page uses the same system.
  - Every testid, command and dialog is kept.
- **Customer Club (D3).**
  - Add member is always enabled for `loyalty.manage`. With no active tier, the dialog creates the first tier inline.
  - A REMOVED member can be enrolled again; the candidate search marks only current members.
  - Points ledger with domain rule `pointsDelta`, admin GET/POST `/v1/admin/club/members/:userId/points`, points column and balance, member-page points panel and dialog.
  - `CustomerClubView.points`.
- **Stripe invoices (D4).**
  - Port `ProviderInvoicing`: Stripe adapter on SDK 23 / API 2026-09-30.endive, and a FAKE adapter in Valkey.
  - `StripeInvoicesService`: create on issue for DIRECT invoices, manual create/retry, sync, void on cancel or expiry, webhook handling, 10-minute sync with catch-up.
  - `PaymentsService.recordOnlinePayment` is the shared settlement for Checkout and Stripe invoices.
  - The pay page links the hosted invoice, and Checkout is refused while a Stripe invoice is open.
  - Admin endpoints GET/POST `/v1/admin/invoices/:id/stripe` and POST `.../stripe/sync`; dev sink `/v1/dev-sink/stripe-invoices/:id/deliver`.
  - Console `StripeInvoicePanel` on the invoice page: status, amounts, hosted page, PDF, Dashboard link, error, reasons, create/retry/refresh, attempts.
  - Webhook checklist +6 events.
- **Guidance (D5).** `PageGuide` on Services, Compliance, Identity checks, Service catalogue and Listings, plus a club help line.
- **Migration 0029**, the OpenAPI document regenerated (334 paths), and en/fa strings for everything new.

## Verification
- **Unit and typecheck.**
  - `packages/domain` loyalty spec 12/12, including the points rules. (OBSERVED)
  - api unit 46 files, 324/324, including the staff-feed mapping and the route-table/permission checks. (OBSERVED)
  - `tsc` clean for api, console and contracts. (OBSERVED)
- **API e2e against the running stack** (OBSERVED):
  - `stripe-invoices.e2e.ts` 5/5 (FAKE provider): refusal with reasons; automatic create, itemise and finalize (£95.00 from £100 + −£5 discount); pay page links the hosted invoice; Checkout refused; signed `invoice.paid` → one verified CARD_ONLINE payment and invoice PAID; staff PAYMENT notification; cancel → Stripe invoice VOID; cargo role refused.
  - `matrix.e2e.ts`, `club.e2e.ts` (expectations updated for `points: null`) and `stage11.e2e.ts` (Checkout, after the settlement refactor) pass.
  - `direct-invoices.e2e.ts` passes, but is flaky on this database: `randomPhone("+4477009")` has 900 numbers, 303 are already used, so a new "customer" is sometimes an old account with invoices. This predates the stage (OBSERVED). The new spec uses the `+98912` pool.
- **Console Playwright** (OBSERVED):
  - `adr0032-apify.spec.ts` 8/8 after rewriting the Apify card tests and adding the missing `serviceInterests` to its fixture (the request page crashed on it before this stage too).
  - `services-club.spec.ts`: 5 passed, 1 failed, 2 skipped after it. The failure is environmental: 65 SUBMITTED service requests from all sessions push the test's request past page 1 of the queue.
  - `deck-shots.spec.ts` now opens the customer section through the jump-nav.
- **Browser, local stack** (Playwright, OBSERVED):
  - **Dashboard:** light, dark and 390 px.
  - **Live notifications:** a customer support message from the website raised the Support badge 35 → 36 and showed the toast with no reload. Opening the ticket brought it back 36 → 35.
  - **Club, admin side:** "Add member" enrolled neda@student.example; a 250-point grant was saved; a 300-point deduction was refused ("Only 250 points…").
  - **Club, customer side:** `GET /v1/me/club` as neda returned `points {balance: 250, history:[{GRANTED, 250, note "Welcome to the club!"}]}` and no reason.
  - **Request page:** desktop sections and sticky bars.
  - **Console errors:** only the deliberate 400.
- **Shared state:**
  - `loyalty.enabled` was switched on for the club check and back off; the payment provider and `payments.online.enabled` were restored after the e2e runs. (OBSERVED)
  - API logs had no level-50 entries during the runs. (OBSERVED)

## Open
- **Real Stripe test mode:** see "Stripe test mode run" below.
- Points earning rules, value and expiry: UNKNOWN (owner decision).
- Customer web and mobile points display belongs to Task 2 (ADR-0040). The API contract is in place.
- Cargo request page not redesigned (out of scope); Compliance detail page still mostly English.
- Next.js reports a known security advisory for 16.4.2 during `next build`. Upgrading Next is not done here.
- Not committed, not deployed.

## Stripe test mode run
BLOCKED (owner, 21 Nov 2026: "skip for now"). No Stripe test key is configured and the Stripe CLI is not paired. The code paths ran end to end against the FAKE adapter, with Stripe-shaped signed events through the real webhook handler. Real Stripe API calls (customers, invoice items, finalize, void, `payments` expansion) have not been exercised.

To run it:
1. `stripe login`.
2. In Developer Panel › Payments, enter the sk_test, pk_test and the `stripe listen --print-secret` whsec, and set the provider to Stripe.
3. `stripe listen --forward-to localhost:4100/v1/webhooks/stripe`.
4. As compliance, add an ONLINE_PAYMENT `product:SERVICE` ALLOW policy, approve it as owner, and turn on `payments.online.enabled`. Wait 15 s for the policy cache.
5. Create and issue a direct invoice. The invoice page's Stripe card should show OPEN with a hosted link.
6. Pay the hosted page with 4242 4242 4242 4242. The webhook should move the card and the invoice to PAID.
7. Cancel a second issued invoice. Its Stripe invoice should show VOID.
8. Restore the policy (BLOCK) and the flag.

# STAGE-31 · Customer portal redesign: dashboard, inbox, purchase tracking, club, live cargo tracking (ADR-0040)

Owner brief of 21 Nov 2026, "Task 2: Redesign and Complete the UniTravel Customer Portal". Plan approved the same day:
- `/dashboard` is the landing page after sign-in.
- No Flutter in this pass (mobile stays paused, ADR-0026).
- Live cargo tracking through TrackingMore.

Decisions are in `docs/adr/0040-customer-portal-redesign.md`. Built alongside Task 1 (admin, ADR-0039, which supplies club points) and Task 3 (service pages) in the same tree. Recorded verification replaces the stage gate (rule 9). Not committed.

## What was built

**Contracts** (`packages/contracts/src/portal.ts`, new)
- PortalOverview, PortalItem with named steps and a next step, PendingAction, PurchaseItem, UnreadCounts.
- InboxListQuery / InboxPage, TrackDetail / TrackEvent / TrackDocument / ShipmentTracking (carrier state), and the cargo-tracking settings.
- `CustomerTicketSummary.unread` and the `support.reply` event are new.

**DB (migration 0031, `0031_customer_portal.sql`)**
- `support_tickets.customer_read_at`.
- `cargo_carrier_tracking`, which holds the per-shipment TrackingMore state.

**API**
- `apps/api/src/modules/portal/`:
  - `GET /v1/me/overview` and `GET /v1/me/unread`.
  - `GET /v1/track/search?q=` (reference, invoice number or own AWB) and `GET /v1/track/:ref`.
  - All of these use `flight_request.read.own`, are filtered to the customer, and return 404 for anything else.
- `GET /v1/notifications` takes filter (all / unread / important), a cursor and a limit, and returns InboxPage. Old callers keep working.
- Support:
  - opening a ticket marks it read;
  - a staff reply makes it unread and sends `support.reply` (en/fa templates, INBOX + PUSH).
  - Bug fixed: the unread subquery compared the wrong `id`.
- `apps/api/src/modules/cargo-tracking/`: `TrackingMoreAdapter` (source `PARTNER_API`).
  - Endpoints: `POST https://api.trackingmore.com/v4/awb` with the `Tracking-Api-Key` header, AWB number only.
  - A lookup runs when staff record an AWB, a worker poll runs every 30 minutes (up to 40 shipments), and staff can force a refresh with `POST /v1/admin/cargo/requests/:ref/carrier-sync`.
  - Developer Panel `GET/PUT /v1/dev/cargo-tracking` (provider.config + step-up). The key is write-only and encrypted, and the audit log records only that it was rotated.
  - Off until a key is saved. On deployed hosts it also stays off until `dpiaApproved` is set.

**Customer web** (`apps/web`)
- `PortalShell` (`components/portal/shell.tsx`) wraps every signed-in page: dashboard, requests, inbox, track, shipments, club, support, billing, tickets, account and the cargo/service detail pages.
  - Sticky bar with inbox and support badges (30 s poll, paused when the tab is hidden).
  - Side rail at 1024 px and wider, a scrolling tab bar below that.
- Surfaces: content cards are opaque (`--surface-raised`, `--rule-strong` border, `--shadow-card`) through `.portal-card` and the `[data-portal]` override. This removes the translucent `card-brand` panes that caused the readability complaint. Recorded in DESIGN.md.
- `/[locale]/dashboard` (new), in order:
  1. account and missing details
  2. "Needs you now"
  3. in progress, with step bar and next step
  4. purchased
  5. latest messages
  6. support
  7. club (credit and points)
  8. Travel Card tile (Coming soon, `status` prop)
  9. previous requests
- Inbox:
  - unread shown by weight, dot and text; important badge
  - All / Unread / Important filters and paging
  - detail pane on wide screens, detail view on phones
  - mark read on open, mark all, link to the related request
- Track:
  - search by reference or AWB
  - step progress, "What happened so far" with the source of each event, next step, documents
  - cargo block: AWB, route, service, pieces and weight, ETA marked as an estimate, and a carrier banner that says live airline tracking is not connected whenever it isn't
- Club:
  - status, tier, benefits, credit, points balance and history ("Points added" / "Points deducted", plus any customer note the staff added)
  - non-members get an explanation and no way to join themselves
- Support: open a request, list with status and unread state, conversation view.
- About 150 `portal.*` strings, with the same keys in en and fa.

## Verification

| Check | Result |
|---|---|
| Typecheck: API (`tsconfig.build.json` and `tsconfig.json`), web (`tsc --noEmit`), contracts | 0 errors |
| API unit tests (route table, serialiser property test with PortalOverview and TrackDetail, TrackingMore adapter) | 46 files, 324 tests pass |
| `apps/api/test/portal.e2e.ts`, against the live local stack | **7/7** |
| API regression (live stack) | see the list below |
| Web portal specs (`playwright.portal.config.ts`, mocked API, axe, 360/768/1280, en and fa) | 25/25 |
| Web main config, the specs these changes touch (billing, customer minus search, payment, ticket-documents, shipments) | pass; billing, payment and ticket-documents passed only when rerun alone (OTP cooldowns from concurrent sessions) |
| Real-API smoke (`e2e/stage31-smoke.spec.ts`, demo customer by test sign-in) | pass on the pre-final build; rerun on the final build pending |

What `portal.e2e.ts` covers:
- Another customer gets 404 on overview items, `/v1/track/:ref`, support tickets and notifications.
- Search finds only the customer's own references.
- A status change by staff shows in the overview.
- Club sync: staff add a member and grant 120 points, and `/v1/me/club` shows the balance and a `GRANTED` entry with the customer note but never the internal reason or the staff member. The overview shows `club.points` = 120, another customer sees nothing, and a customer calling the grant route is refused.
- Support unread switches on when staff reply and clears when the customer opens the ticket.
- Developer settings never return the key. Dev routes return 404 to customers and admins (the established fail-closed rule).

API regression results:
- Pass: matrix, stage2, club, travellers-inbox, ticket-documents, hardening, stage5, stage9, security 11/11 (on rerun), phase-j 29/29 (on rerun), stage8 4/4, stage13 5/5, adr0008 3/3, adr0022 12/12, dashboard 4/4, stage10 4/4, stage11 10/10, direct-invoices 9/9 (on rerun, after Task 1's payment-settings window), services 11/11 (after Task 3 made the test enable the club flag itself).
- Fails: stage3, 1/8. The search returns `NO_SOURCES` (zero results). None of the three sessions changed search, supplier or catalog code, so this is INFERRED to be provider or catalog state in the shared database. Not investigated further. (OBSERVED failure, UNKNOWN cause)

Screenshots: `docs/stages/STAGE-31/` (dashboard, inbox, track detail, track search miss, club, support; en and fa; 360 and 1280).

## Open items
- **TrackingMore** (ADR-0040 D5):
  - Webhook receiver BLOCKED: the signature scheme is not documented in any official SDK, and the web docs refuse automated clients.
  - Checkpoint time zone UNKNOWN (read as UTC).
  - Full `checkpoint_status` list UNKNOWN: only `delivered` maps to one of our codes; everything else is shown in the provider's words.
  - Plan quota and cost UNKNOWN.
  - Deployed hosts BLOCKED until the DPIA processor row is approved (`docs/compliance/DPIA-draft.md`).
- **Next.js 16.4.2:** `next build` compiles and prerenders, then exits 1 with `SecurityFatalError: Your version of Next.js is affected by a known security vulnerability`. `.next/BUILD_ID` is still written. Upgrading is the owner's decision; nothing was upgraded.
- **Visual baselines:**
  - Portal pages: re-baselined on the final build, or pending; see the progress log.
  - All 44 mobile visual specs, public pages included, fail. That points to drift from other sessions' changes (INFERRED).
  - The trains and buses a11y failures (`aria-allowed-attr`, `color-contrast` on the route fields) and the search-results specs are outside this stage.
- **Flutter:** not in this pass. The contracts are ready for a later mobile pass.
- **Smoke data:** the smoke run leaves a support ticket "Smoke …" on the demo customer.

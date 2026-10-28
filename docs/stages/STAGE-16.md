# Stage 16 record: Phase I, menu, service requests, tracking, support, customer club

Source: `docs/CONTENT-MENU-LIVE-DATA.md` §4 (owner message of 27 Oct 2026). ADR-0015 (service requests and verticals, deviates from D-04) and ADR-0016 (customer club). Backend for service requests, `GET /v1/site`, purchase tracking and the stay/ground ports landed in `edcfebd`; this stage adds the customer club backend and every screen.

Owner decisions applied as proposed defaults: O6–O10 (visa, insurance, CIP, tours and the four listing verticals sit behind flags that default **off**), O8/O8b (no hotel, stay, rail or bus provider, so no listings: with a flag on the page is a request form, never fake results), O13/O15 (placeholder contacts and unconfirmed hours are never shown), O14 (Safar card not built).

## What changed (DOCUMENTED)

**Customer club backend (ADR-0016)**
- Migration `0011_customer_club.sql`: `loyalty_tiers`, `loyalty_members`, `loyalty_benefits` (checks: one tier or one member, non-empty window, approver ≠ author), `loyalty_ledger` (append-only trigger; `migrate.ts` grants the app role SELECT and INSERT only). Schema `packages/db/src/schema/loyalty.ts`.
- Domain rules `packages/domain/src/loyalty.ts` with property tests: four-eyes need, effective status, `checkClubDiscountLine`, ledger balance and the no-overdraft debit rule.
- `apps/api/src/modules/loyalty/`: tiers, member search and enrolment, member changes, benefits (create, approve by a different person, revoke with the unused bonus credit reversed), ledger entries (USED names an issued or paid invoice of that customer and currency; debits serialised per customer), customer view `GET /v1/me/club` (200 with `enabled: false` while the flag is off). Every change audited. Welcome notice `loyalty.member_added` (inbox, email; en/fa template; matrix row).
- `club-discount.hook.ts` now validates CLUB_DISCOUNT lines on service quotes instead of refusing them: member active, benefit theirs or their tier's, approved, in its window, for SERVICE or ANY, amount within the benefit, each benefit once per quote.
- Contracts: list queries, revoke body, candidate search (`packages/contracts/src/loyalty.ts`); OpenAPI regenerated.

**Customer web (`apps/web`)**
- Menu from `GET /v1/site` (`lib/site.tsx`): desktop bar = enabled booking verticals, a "Services / خدمات" disclosure menu (visa, tours, CIP, cargo, shipments, insurance), Track, My requests, Support icon; mobile menu in three groups (Book, Services, Help); footer columns follow the same flags. Persian cargo label set to the owner's «ارسال بار و کارگو».
- Pages: `/visa`, `/tours`, `/cip` (IKA only), `/insurance`, `/hotels`, `/stays`, `/trains`, `/buses` (shared `ServiceFormFrame`; a switched-off service shows "not available" to everyone and links to support; sign-in is asked only when the service is on), `/services/[ref]` (details, quote with lines and accept, messages, timeline, cancel), `/track` (signed-in list with filters; signed-out reference + phone → code → timeline, proof of work when asked, never says whether the reference matched), `/support`, `/club`.
- "My requests" lists service requests; the buying guide reads visa, insurance and online-card flags from `/v1/site` on the server (`lib/site-server.ts`).
- en/fa strings in `packages/i18n` (nav, services, track, support, club).

**Admin Panel (`apps/console`)**
- `/services` (type chips, status, mine, paging) and `/services/[ref]` (customer, details, messages, quotes, timeline, command bar from `allowedCommands` with version-conflict handling; quote builder with live total and club discount lines limited to usable discount benefits; server field errors shown per line).
- `/club` (members, add member with customer search), `/club/benefits` (filters, create, approve for `loyalty.benefit.approve`, revoke), `/club/tiers`, `/club/[userId]` (membership changes with reason, benefits, credit ledger and entries). Rail entry only with `loyalty.read` and the club switched on.

**Flutter (`apps/mobile`)**
- Account › Services lists the website's switched-on service pages (`lib/core/site.dart`, `SiteServiceLinks`) and opens them in the browser like Help; ARB and generated localisation files updated by hand (en/fa).

**Compliance seed fix (found while testing, pre-existing since migration 0007)**
- `packages/db/src/seed/index.ts` seeded the compliance policies only when *no* policy existed. Migration 0007 inserts ONLINE_PAYMENT policies, so on every database created after it the seed skipped the D-01 carrier BLOCK (all Iranian-registered carriers), the goods and keyword lists and the Iran lane policies. OBSERVED on a fresh local database: only ONLINE_PAYMENT and SERVICE policies existed, and the API e2e caught it (blocked carrier W5 in benchmark results, prohibited goods not declined, Iran excess baggage offered).
- The guard now checks for the D-01 policy (`CARRIER` / `country:IR`, any status). Re-running the seed adds the 67 missing policies once; a second run adds nothing (OBSERVED: 7 → 74 → 74). **Any deployed database created after 24 Oct 2026 should be checked** (`select count(*) from compliance_policies where type = 'CARRIER'`) and re-seeded after this change is deployed; the compliance officer confirms the seeded rows as for the original seed.

**Tests added**: `packages/domain/src/loyalty.spec.ts`, club routes in `apps/api/src/routes.spec.ts`, `apps/api/test/club.e2e.ts`, `apps/web/e2e/site-menu.spec.ts`, `apps/console/e2e/services-club.spec.ts`. `apps/web/e2e/helpers.ts` and `apps/console/e2e/helpers.ts`: sign-in fills the first email field (the test sign-in box has a second one and could render first, a flake in every spec).

## Verification (OBSERVED, 28 Oct 2026)

Environment: no Docker here, so PostgreSQL **16** (project uses 18), Redis 7, a local S3 mock (moto) and an SMTP sink (aiosmtpd) on the dev ports; Chrome for Testing 153 for Playwright. Migrations 0000–0011 applied cleanly on 16.

| Check | Result |
|---|---|
| Typecheck (tsc per package; turbo cannot spawn in this sandbox) | contracts, domain, engine, db, i18n, ui, api, web, console: 0 errors |
| Unit | domain 106/106 (incl. 9 new club tests), engine 7, db 4, i18n 12, api 77/77 (incl. club route declarations), ui token check passes |
| Migrations | 0000–0011 apply on a fresh database; `loyalty_ledger`: app role has INSERT, no UPDATE; benefit checks present |
| API e2e `club.e2e.ts` | 6/6: flag off answers `enabled: false`; tier, candidate search, enrolment, welcome notice; four-eyes approval; bonus-credit ledger never below zero, manual grant above threshold refused, revoke reverses only unused credit; service quote accepts a valid club discount and refuses too large, repeated and someone else's; suspension hides benefits |
| API e2e `services.e2e.ts`, `matrix.e2e.ts` | 9/9, 22/22 (permission matrix exact for all roles, including the club routes) |
| API e2e, full suite | One run of all files at once: 15 failures, all from the shared demo-staff OTP/TOTP cooldowns, Mailpit, or the compliance seed bug (fixed above). Each failed file re-run alone after the fix: adr0008 3/3, club 6/6, dashboard 4/4, hardening 10/10, matrix 22/22, platform 4/4, stage1 8/8, stage2 4/4, stage3 10/10, stage5 4/4, stage11 10/10 (one stale assertion from ADR-0013 updated: the resend sends `payment.requested`, not a second `invoice.issued`). stage8, stage10, stage13: one test each needs Mailpit's HTTP API on port 8035, not available here (BLOCKED, environment) |
| Web e2e `site-menu.spec.ts` (new) | 5/5: menu follows flags (en, fa, fresh visitor after the 60 s cache); switched-off pages show the notice to anonymous visitors; visa request from form to detail, My requests and Track; support hides placeholders and never claims 24 hours; club page follows its flag; signed-out tracking never reveals a match. axe: no serious or critical violations on each |
| Web e2e, all non-visual specs | 52 passed, 2 failed: `site-menu` before the proof-of-work fix (now passing) and `customer.spec.ts` step 2 (pre-existing text mismatch, see Open) |
| Console e2e `services-club.spec.ts` (new) | 3/3: queue and detail; claim and send a quote with a club discount line (total £45 = £60 − £15); members list, member page, owner approves a benefit the admin created. axe clean on queue, detail, quote dialog, members and member page |
| Console e2e `console.spec.ts` | 14/15; the failure is a direct Node request to `admin.localhost`, which this sandbox's DNS does not resolve (BLOCKED, environment) |
| Web and console production builds | both succeed, new routes listed |
| Flutter | not run (no SDK here) |

## Open
- **Visual baselines**: the header, mobile menu and footer changed on every page, so `apps/web/e2e/visual.spec.ts` and the console visual suite need re-baselining on the usual machine (`--update-snapshots`); not done here because this machine's Chrome build differs from the baseline machine's.
- **Flutter not analysed**: no Flutter SDK here. Run `flutter gen-l10n` (or keep the hand-edited files), `flutter analyze` and `flutter test` before merging.
- **Notification matrix on existing databases**: `loyalty.member_added` (and the service events from `edcfebd`) are in `DEFAULT_NOTIFICATION_MATRIX`; an existing database keeps its published matrix version, so publish a new NOTIFICATION_MATRIX version in the Developer Panel or the notices are not sent there.
- Console ledger dialog: `GET /v1/admin/invoices` has no customer filter, so the invoice picker lists all issued/paid invoices in the currency; the server enforces ownership. A `customerUserId` filter would make the picker exact.
- Persian copy in the console was machine-drafted; ask a native speaker to review. Customer-facing Persian (packages/i18n) was written for this stage and should also be read once by the client.
- `apps/console/e2e/adr0013.spec.ts` (from ADR-0013, never run in STAGE-13) has stale label selectors ("Fare" also matches the fare-rule selects; "Extra service 1" matches two fields); not changed here.
- `apps/web/e2e/customer.spec.ts` step 2 looks for "options found", but the search page says "Search complete · 9 options": pre-existing mismatch, unrelated to this stage.
- Hotels, stays, trains and buses still need a contracted provider and adapter before any listing can be shown (ADR-0015); visa, insurance and CIP still need counsel before their flags go on.

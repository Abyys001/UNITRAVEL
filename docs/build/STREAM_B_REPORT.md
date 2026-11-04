# Stream B report: customer web

Branch `stream-b` (base 7bb1fca). Stage STAGE-26. Cites ADR-0031 I5, MASTER_PLAN section 3 "B", section 5 items 2 and 5.

## Changes

| Item | Where |
|---|---|
| "Also interested in" fieldset/legend + checkboxes from `GET /v1/services-catalog`; hidden when empty or the call fails (`retry: false`, never blocks submit); name/description by locale; price shown only if the API sends `priceMinor`+`currency`; max 20 | `apps/web/src/components/service-interests.tsx` (`ServiceInterests`), used at `apps/web/src/app/[locale]/request/new/page.tsx:168`, body `serviceInterests` at `:90` |
| `ComplianceReviewNote` (ADR-0031 I5 wording, `role="note"`) | `apps/web/src/components/compliance-review-note.tsx`; rendered at `itinerary/[id]/page.tsx:46` and `request/new/page.tsx:120` when `itinerary.complianceReview` |
| "You asked about" (names only, nothing priced) | `service-interests.tsx` (`RequestedInterests`), used at `requests/[ref]/page.tsx:137` |
| en/fa strings: `svcInterest.{title,hint,asked,price}`, `complianceReview.note` | one block at the end of `packages/i18n/src/en.ts` and `fa.ts`, comment `// STAGE-26 stream B` |
| Price-leak crawl + pure scanner + 3 unit tests | `apps/web/e2e/price-leak.spec.ts` |

Billing (item 4): `billing/[number]/page.tsx` already shows lines with a type label (`lineTypeLabel`, includes BAGGAGE in en/fa), total, status, Pay button (only when the server offers it), offline instructions, and PDF. OBSERVED by reading; no change needed, no DRAFT or market fare path in it.

## Leak spec coverage
Logged out: home en/fa, search (home default query, FAKE provider), results, itinerary detail, request/new (lands on sign-in). Signed in (`neda@student.example`): same flow plus request/new form, a submitted request, `/requests`, `/requests/[ref]`, `/fa/requests`. Billing test: shipment invoice issued through staff API (as `billing.spec.ts`), then `/billing`, `/billing/[number]` en and fa with the customer's cookies. Per page it collects rendered HTML (includes `self.__next_f` pushes and `__NEXT_DATA__`), every same-origin or API-origin html/json/js/x-component response, script chunks fetched when served from cache, and console + pageerror output. Asserts zero `"key":` hits (also escaped `\"key\":`) for `FORBIDDEN_CUSTOMER_KEYS` (imported from `apps/api/src/testing/leak.ts`) and zero for `google.com/travel`, `google.com/flights`, `booking_token`. Also asserts the crawl was not vacuous (html, js and api JSON counts).

## Run status
- `pnpm -r typecheck`: green. Spec typechecked separately (`tsc --ignoreConfig --strict`), since `e2e/` is outside the web tsconfig.
- Spec unit tests (`scanForLeaks`, 3 tests): PASSED, run with a temporary config without `globalSetup` (removed after).
- Browser crawl (3 tests): **NOT RUN.** OBSERVED: web answers on :4000 but `GET :4100/v1/services-catalog` returned 404, so the running API is a build without Stream C and not this branch; the config's `globalSetup` also writes to the shared dev DB. I did not start or stop anything.
- No web unit tests and no lint script exist in `apps/web`.
- Mobile/RTL screenshots: not taken (no stack for this branch). INFERRED RTL-safe: logical classes (`ms-`, `float-start`, `dir="auto"`), no physical left/right.

## Open items
1. Crawl must be run against a stack built from the merged branch (migration applied, catalogue items active) before the verification report.
2. Possible false positives in JS chunks for the short keys `score` / `explain` if some bundled JSON uses them as quoted keys; if the run flags them, inspect the hit snippet rather than loosening the list.
3. Result cards: `ComplianceReviewNote` is ready to drop in (`<ComplianceReviewNote show={it.complianceReview} />`); the other session owns the cards.
4. Contract gap (from Stream C item 1, outside my files): `invoices.service.ts` `draftFromQuote` does not copy `lineType` into `invoice_lines.serviceType`, so catalogue lines show no type label (e.g. Baggage) on the customer invoice until fixed.
5. Catalogue seed items are inactive and priced 0 (Stream C), so the interests fieldset stays hidden until staff activate items.
6. `GET /v1/services-catalog` is called with the customer's cookies like other calls; it is public, so logged-out users would see the list if the form were reachable (it redirects to sign-in).

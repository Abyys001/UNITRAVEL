# Stage 7 record: Phase A, price confidentiality

Source: `docs/ADDITIONAL-REQUIREMENTS.md` (Phase A, owner decision 2), `docs/adr/0004-price-confidentiality.md`, booklet ch. 7.4, 11.3, 22.6, 22.9, 35.1 rules 3 and 10. Measured locally on 23 Oct 2026.

## What changed (DOCUMENTED)
- ADR-0004 records the deviation, the grants and what customers still see.
- Contracts: `CustomerItinerary`, `CustomerOffer`, `CustomerSeatMap`, `CustomerSearchState`; the request snapshot view uses the customer itinerary; `acceptPriceChange` and `PRICE_CHANGED` removed. Permissions `pricing.read.internal`, `pricing.write`, `commercial_document.issue` (admin and owner; migration `0003_pricing_permissions` for existing databases, seed for new ones).
- API: customer search, itinerary, seat-map and snapshot responses use the projection; the customer price-check route is gone, the staff one needs `pricing.read.internal`; the CHEAPEST tab answers 400 without it; submit records `priceAtSubmit`/`priceRevalidated` for staff and never blocks on a price change; quote draft create/edit need `pricing.write`, `send_quote` needs `commercial_document.issue`, "from snapshot" and cost/supplier fields need `pricing.read.internal`.
- Engine: price removed from the cost, tie-break and single-ticket lift; neutral customer order.
- Web: no amounts on results, itinerary, seat map or request screens; price-check button and "price changed" prompt removed; en/fa copy "Price confirmed in your quote". Flutter: same, models no longer read `price`; l10n regenerated. Console: supplier totals, snapshot prices, internal cost and "from snapshot" hidden without `pricing.read.internal`.
- OpenAPI regenerated (`packages/contracts/openapi.json`).

## Verification
| Check | Result | Label |
|---|---|---|
| Typecheck: contracts, domain, engine, db, i18n, api, web, console | 0 errors | OBSERVED |
| Unit: domain 22, engine 7 (price-not-a-ranking-input property replaces the old monotonic test), api 13 (serialiser property tests: any amount-shaped field in a customer search result, itinerary, seat map or request detail outside a sent quote fails; guard self-check; route table pins the pricing permissions) | all pass | OBSERVED |
| API e2e, full run (`pnpm test:e2e`): 6 files, 49 tests, including the permission matrix for the new permissions, stage3 (no amounts for customers, customer price check 404, staff price check, plain staff gets the projection, price change at submit never blocks and staff see both prices) | 49/49, no OTP flake this run | OBSERVED |
| Flutter `flutter analyze` | no issues | OBSERVED |
| Flutter `flutter test` (run with proxy variables unset, see apps/mobile/README.md) | 32 pass (30 before plus 2 price-confidentiality tests) | OBSERVED |
| Web Playwright (`apps/web/e2e/customer.spec.ts` updated: results show "Price confirmed in your quote", no currency symbol on the itinerary page, no Re-check button) | 26/26 passed incl. axe, desktop + mobile, against the rebuilt web on :4000 (23 Oct 2026) | OBSERVED |
| Console Playwright | not run: needs a rebuilt console service; console typecheck is clean | BLOCKED |

## Limits and open items
- `weights.price` remains in the rule schema and the Developer Panel; it is ignored by the engine. Removing it is a config schema change left for a later cleanup (INFERRED: harmless).
- Provider name and offer id still appear in the customer snapshot's `source`; unchanged from before and not an amount (UNKNOWN whether the owner wants them hidden).
- A fee-bearing change/refund condition now reads only "allowed"/"not allowed" for customers; the fee is stated in the sent quote if staff enter it.
- Cargo quote editing is not covered by `pricing.write`; revisit in Phase C.
- Mobile admin mode screens were not changed.

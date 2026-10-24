# ADR-0004 · Price confidentiality before a sent quote

Status: accepted (owner decision 2, 23 Oct 2026, `docs/ADDITIONAL-REQUIREMENTS.md`). Supersedes the parts of the booklet listed below.

Context: the booklet shows the customer a live total on search results and itinerary detail (ch. 11.3), per-seat prices on seat maps (ch. 7.4), a customer-facing price check and "price changed" confirmation at submit (ch. 22.9, ch. 15.3 for the staff variant), a Cheapest tab (ch. 11.3, 22.4 step 8) and a price weight of 0.35 in the ranking (ch. 22.6). The owner decided that a customer sees an amount only on a sent quote or an issued invoice: supplier prices are a staff input, the quote is the commercial offer (ch. 13.6) and the service fee is added by staff. Ch. 35.1 rule 10 requires an ADR for deviations; the truth model (rule 3) is not weakened, because the quote remains the only priced customer artefact and the snapshot is still immutable.

## Decisions

| # | Booklet | Now | Code |
|---|---|---|---|
| P1 | Search results, itinerary detail and snapshot show totals and ticket prices (ch. 11.3, 24.8) | Customer projections carry no `Money` field at all: fields are removed, not zeroed. Also removed: fee penalties on change/refund conditions, the price-derived `score` and `explain`, the `CHEAPEST` tab | `CustomerItinerary`, `CustomerOffer`, `CustomerSearchState`, `OfferSnapshotView` in `packages/contracts`; `apps/api/src/modules/search/customer-projection.ts` |
| P2 | Paid seats show a price (ch. 7.4) | Customer seat maps show availability and characteristics only | `CustomerSeatMap` |
| P3 | Customer price check; a changed price is shown for confirmation at submit (ch. 22.9) | The customer price-check route is removed. At submit the offer is still revalidated and the original and revalidated totals are recorded on the snapshot for staff, but a price change never blocks or prompts the customer (`acceptPriceChange` and the `PRICE_CHANGED` error code are removed). An expired or unavailable offer still stops the submit (that is availability, not price) | `RequestsService.create`; staff route `POST /v1/admin/itineraries/:id/price-check` |
| P4 | Ranking weights price at 0.35 and breaks ties by price (ch. 22.6); single tickets are lifted over separate tickets priced within N% (ch. 22.11) | Customer ordering is neutral: price is not an input to the cost, ties break on duration then id, and the single-ticket lift no longer tests a price. `weights.price` stays in the rule schema for compatibility but is ignored; `limits.singleTicketPreferenceWithinPct` is unused. `explain.price` is still computed for staff with `pricing.read.internal` | `packages/engine/src/score.ts`, `assemble.ts`; property test "price is not a ranking input" |
| P5 | Staff search shows supplier totals to all search users | Staff see supplier totals, scores, the Cheapest tab and fare-basis detail only with `pricing.read.internal`; without it they receive the customer projection | `StaffSearchController` |

## What customers still see
- Amounts in a **sent quote** (`priceBreakdown` of each option, the accepted total) and in **issued documents** (invoices, Phase C). Quote options still exclude supplier price, supplier timestamps, supplier offer ids and internal cost (earlier fix, 23 Oct 2026).
- Neutral copy where a price used to be: "Price confirmed in your quote" (en/fa, web and Flutter).
- A customer-entered budget on a manual request is the customer's own input and is unchanged.

## Permissions (`packages/contracts/src/permissions.ts`)
| Permission | Gates | Granted to (default) |
|---|---|---|
| `pricing.read.internal` | Supplier totals, scores and Cheapest tab in staff search; staff price check; snapshot `priceAtSubmit`/`priceRevalidated`; quote option cost, supplier price and offer ids; "from snapshot" quote option | `admin`, `owner` |
| `pricing.write` | Creating and editing quote drafts (setting the customer price) | `admin`, `owner` |
| `commercial_document.issue` | The `send_quote` transition (the first priced document the customer receives); invoices from Phase C | `admin`, `owner` |

Rationale for grants: `admin` is the operations role that builds and sends quotes today (it held `quote.create`), so withholding the new permissions would stop the quote workflow. `cargo_admin` is not granted `pricing.write` because the flight quote routes it would unlock are not cargo's; cargo quoting keeps its existing permission and is revisited in Phase C. `compliance_officer`, `developer` and `customer` hold none. A staff member who holds `pricing.write` without `pricing.read.internal` cannot edit a draft that already holds internal cost (the edit would silently erase it). Existing databases receive the grants through migration `0003_pricing_permissions` (which also bumps `perm_version` so sessions refresh); new ones through the seed. `quote.create` still gates the quote read view and the other quote commands.

## Consequences
- Fewer customer-visible facts before a quote; sales conversation moves to the quote. Acceptable to the owner (decision 2).
- A customer cannot learn that a fare moved; staff see it on the snapshot and re-quote.
- The Cheapest tab remains for `pricing.read.internal` holders. A price-sorted list for anyone else would leak prices by order alone, so it answers 400.
- Tested by: `apps/api/src/serialisers.spec.ts` (any amount-shaped field in a customer response outside a sent quote fails), `packages/engine` property test, `apps/api/src/routes.spec.ts`, permission matrix and `stage3.e2e.ts`, `apps/mobile/test/logic_test.dart`.

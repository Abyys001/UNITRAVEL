# Stream C report: service catalogue, request interests, external booking reference

Branch `stream-c` (base 08eed8a). Stage STAGE-23. Cites ADR-0030, ADR-0031 (I4, I6), booklet ch. 13, 27.

## What was built

| Item | Where |
|---|---|
| Schema `service_catalog_items`, `request_service_interests` | `packages/db/src/schema/services.ts` (end of file) |
| Schema `reservations`: `record_locator` nullable, `external_reference`, `note`, CHECK `reservations_ref_chk` | `packages/db/src/schema/requests.ts` (reservations table) |
| Seed: INSURANCE, CIP, BAGGAGE, VISA, TRANSFER (price 0, hidden, **inactive**, inserted only if missing, needs an owner user) | `packages/db/src/seed/service-catalog.ts`, wired in `seed/index.ts` |
| Catalogue module (service, controllers) | `apps/api/src/modules/services-catalog/`, registered in `apps/api/src/modules/business.module.ts` |
| Interests on submit (validated before the transaction, inserted inside it, audited) and on both detail views | `apps/api/src/modules/requests/requests.service.ts` (`create`, `interestViews`, `customerDetail`, `staffDetail`) |
| Catalogue lines on quotes: `catalogueLines` input becomes `priceBreakdown.extras` with `catalogueItemId`, `lineType`, `quantity`, `unitAmountMinor`; price default or override; quantity defaults to passenger count if per passenger | `apps/api/src/modules/requests/quotes.service.ts` (`withCatalogueLines`), contract `packages/contracts/src/requests.ts` (`PriceLine`, `CatalogueLineInput`, `QuoteOptionInput.catalogueLines`) |
| ADR-0031 I4: Iranian airport in the query slices (airport or city, via `ReferenceService.countryOfPlace`) adds `IRAN_AIRPORT` evidence, so `screen` opens a case and runs `screen_flag` (SUBMITTED to COMPLIANCE_HOLD) | `apps/api/src/modules/requests/flight-lifecycle.ts` (`screen`) |
| ADR-0030: guard removed, `externalReference` and `note` stored and returned; domain guard accepts null locator when an external reference exists | `apps/api/src/modules/bookings/bookings.service.ts`, `packages/domain/src/flight-request.ts` |
| Contract: `FlightRequestCustomerView.serviceInterests`; `UpdateServiceCatalogItemBody` redeclares `showPriceToCustomer` without its default (otherwise a PATCH of one field silently reset the flag) | `packages/contracts/src/requests.ts`, `service-catalog.ts` |
| Console: catalogue CRUD page, nav entry (`service_catalog.manage`), "attach services" in the quote editor, interests panel, reservation dialog and record display with external reference and note, I6 warning on the compliance decision screen, `invd.type.BAGGAGE`, en and fa strings | `apps/console/src/app/admin/(app)/services/catalog/page.tsx`, `components/quote/{model.ts,option-editor.tsx}`, `components/flight/records.tsx`, `app/admin/(app)/requests/[ref]/page.tsx`, `app/admin/(app)/compliance/[id]/page.tsx`, `components/admin-frame.tsx`, `lib/i18n.ts`, `lib/types.ts` |

## Routes added (for the openapi regeneration at merge)

| Method and path | Access |
|---|---|
| `GET /v1/services-catalog` | public, active items, price only if `showPriceToCustomer` |
| `GET /v1/admin/services-catalog` | `service_catalog.manage`, staff |
| `POST /v1/admin/services-catalog` | `service_catalog.manage`, staff, audited |
| `PATCH /v1/admin/services-catalog/:id` | `service_catalog.manage`, staff, audited, code immutable |
| `GET /v1/admin/services-catalog/options` | `pricing.write`, staff (active items with default prices for the quote editor; added because quote writers do not hold `service_catalog.manage`) |

Changed shapes: `POST /v1/flight-requests` (serviceInterests, already in contract), quote draft bodies (`options[].catalogueLines`), staff request detail (`serviceInterests`, reservation `externalReference`/`note`, `recordLocator` nullable), customer request detail (`serviceInterests`), reservation body (already in contract).

## Schema changes needing the migration (not generated, not pushed)

1. `CREATE TABLE service_catalog_items` (uuid pk, `code` varchar(32) unique, names, descriptions, `line_type` varchar(20), `default_price_minor` integer, CHECK `>= 0`, `currency` char(3), `per_passenger`, `show_price_to_customer` default false, `active` default true, `created_by` FK users, timestamptz audit columns).
2. `CREATE TABLE request_service_interests` (`request_id` FK flight_requests ON DELETE CASCADE, `catalogue_item_id` FK, `created_at`, unique `rsi_pair_uq`, index `rsi_request_idx`).
3. `ALTER TABLE reservations`: `record_locator DROP NOT NULL`, `ADD external_reference varchar(64)`, `ADD note text`, `ADD CONSTRAINT reservations_ref_chk CHECK (record_locator is not null or external_reference is not null)`.
4. Check whether the app role needs grants on the two new tables (as for other tables); review by hand after generation.

## Tests

| Run | Result |
|---|---|
| `pnpm -r typecheck` | green (all packages and apps) |
| `pnpm --filter ./apps/api test` (unit) | 25 files, 188 passed, 1 skipped |
| `packages/contracts` vitest | 6 files, 31 passed (new `service-catalog.spec.ts`: 7 tests) |
| `packages/db` vitest | 8 passed |
| `packages/domain` vitest | 115 passed, 1 failed: `name-matcher.spec.ts` property "same given name with a different surname" (counterexample `Reza / Sharifi / Shirazi`). INFERRED unrelated and pre-existing (I changed only `flight-request.ts`; that spec is the screening name matcher), not re-run on the base |
| New unit tests | `apps/api/src/modules/services-catalog/services-catalog.spec.ts` (3: price absent unless flagged, `findForbiddenKeys` clean, no `createdBy`), route table rows in `routes.spec.ts` (1), property test in `packages/domain/src/domain.spec.ts` updated for null locator |
| `apps/api/test/services-catalog.e2e.ts` | written, typechecked, **NOT RUN**. `test/global-setup.ts` connects to the shared dev database (`localhost:5462`) and Redis and deletes OTP challenges there, and the new tables do not exist in it. 7 tests: CRUD authz, create/edit/uniqueness/audit, public projection, interests on submit, quote with catalogue line to invoice line (DB check), reservation with external reference only (and ticket refusal), Iran hold vs non-Iran. Matrix row added in `test/matrix.e2e.ts` (also not run) |

## Open items and decisions for the owner

1. **Invoice lines do not carry the line type yet (INFERRED, needs a one-line change outside my ownership).** `apps/api/src/modules/invoices/invoices.service.ts` `draftFromQuote` maps `pb.extras` to lines with quantity 1 and `serviceType` null. The catalogue extras already carry `lineType`, `quantity` and `unitAmountMinor`; the invoice line description and amount are correct and the total reconciles. To store the type and quantity, map `e.lineType`, `e.quantity ?? 1`, `e.unitAmountMinor ?? e.amount.amountMinor` into `invoice_lines` (`serviceType`, `quantity`, `unitAmountMinor`). I did not edit `invoices/**`. The e2e asserts description and amount only.
2. **Existing e2e fixtures will break under I4 (OBSERVED by grep, not run).** `adr0008`, `platform`, `stage2`, `stage8`, `stage10`, `stage13` e2e files submit manual requests from `THR`, which now go to COMPLIANCE_HOLD instead of NEW, so their "wait for NEW" steps fail. The fix is to use a non-Iranian origin (for example `IST`) in those request bodies; the sandbox refused my edit of those files, which are outside my ownership. `stage3` runs searches only. The decision to hold every Iran-touching request is ADR-0031 I4, so the fixtures, not the rule, should change.
3. **Seed catalogue is inactive and priced at 0.** I did not invent Uni Travel's prices or copy. Staff activate and price items in the console. Currency GBP is INFERRED from the demo data.
4. **Customer-facing catalogue (apps/web, Stream B).** Consumes `GET /v1/services-catalog` and sends `serviceInterests` codes.
5. **Staff quote editor shows only catalogue items in the quote currency** (prices are never converted).
6. Inactive items cannot be newly attached; a draft that already holds a since-deactivated item fails on the next save until the line is removed (unknown or inactive: VALIDATION_FAILED).
7. I6 warning shows on the compliance decision screen when RELEASE is chosen on a case whose evidence is `IRAN_AIRPORT` or `ROUTE_POLICY`.
8. Console reservation dialog and some quote editor strings were already hard-coded English; I added en and fa strings only for the new text and left the rest as it was.

# STAGE-32 · Customer service pages: form kit, guided requests, paged flight results (ADR-0041)

Owner brief of 21 Nov 2026, "Task 3: Redesign All UniTravel Service Pages and Request Flows". Plan approved the same day. Built while two other sessions worked in the same tree (Task 1: Admin Panel, ADR-0039 / STAGE-30; Task 2: ADR-0040 / STAGE-31). Not committed, not deployed.

## What was built

**Form kit** (`apps/web/src/components/form/`)
- FieldShell, DateField (Popover + `Calendar`, Jalali-aware, year/month jump), DateRangeField, CounterField, SelectField (Base UI `Select`), ComboField (searchable, folds Arabic ی/ك and digits), Wizard (progress bar, "Step n of N", per-step Zod checks, draft in `lib/form-draft`, fade between steps behind `motion-safe`), ReviewList, ConfirmationPanel.
- `Calendar` gained `max`, `initialCursor`, `onViewChange` and an empty `start`.
- `DestinationPicker` is now a thin wrapper over ComboField.
- No native date, number or select inputs remain on customer service pages. The exception is the cargo measurement and value fields, which are typed numbers with the spinners hidden.

**Pages**
- **Hotels, Trains, Buses, Villas (stays), Insurance, Tours:** kit controls plus a shared `ServiceIntro` block (what it offers, how it works, what you need, what happens next). Trains and Buses have a From/To search, popular cities first, a swap button and a same-city error. Also converted: request/new, account, add-identity, support form, traveller form.
- **Flight results** (`catalog-view.tsx`, `components/flight-results/`):
  - a filter bar (stops, airline with counts, departure window, sort)
  - paged 10 at a time with an accessible pager, all state in the URL
  - with flexible dates: date tabs, and paging within the chosen date
  - `search/loading.tsx` and `search/error.tsx`
  - The dead `result-card.tsx` was removed.
- **Cargo:** a five-step wizard (route, service, shipment, contact and documents, review). `CreateCargoRequestBody` is unchanged; the conditional air-freight fields are as before.
- **Visa:** the checker stays. A five-step request wizard (destination, purpose, applicants, documents, review) follows, with non-guarantee copy on the intro, review and confirmation. Documents can be sent with the request. `/services/[ref]` now has message attachments.
- **CIP:** a dedicated IKA page (services, good to know, how it works, FAQ) and a five-step wizard (airport, trip, options, notes, review). Departure-only options are disabled on arrivals.
- **ServiceFormFrame:** `useServiceSubmit` (shared by the frame and the wizards), field-level errors, a submitting state, and a ConfirmationPanel with "Open request" instead of a silent redirect.

**Contracts and API**
- `CipDetails.services?` (`CipService`) and `companions?`, with departure-only options refused on ARRIVAL.
- `CreateServiceRequestBody.documentIds?` (up to 10), attached at create through `documents.attach`: a foreign id returns 404. A thread note is added in the request locale.
- **Staff email:** the new event `service_request.new` goes to ON_DUTY_ADMINS as INBOX+PUSH+EMAIL, with staff wording and an absolute Admin Panel link (`PUBLIC_CONSOLE_ADMIN_URL/services/<ref>`). The customer `service_request.submitted` is unchanged. Templates are seeded (insert-or-ignore). No migration is needed: an event with no stored matrix row falls back to `DEFAULT_NOTIFICATION_MATRIX`.
- OpenAPI regenerated (`packages/contracts/openapi.json`; the diff also carries Task 1 and Task 2 routes).

**i18n**
- New strings live in `packages/i18n/src/flow.*.ts` and `guide/*.ts`, mounted as `guide.*`, so parallel sessions did not collide in en.ts and fa.ts.
- Stay region labels were updated (gulf now "Southern coast and islands"; new "mountain" and "other").
- `formatDate` now writes Persian dates with weekday and year as "شنبه ۱۴ آذر ۱۴۰۵". ICU's pattern put the year first and used a Latin comma.

**Villa destinations:** `STAY_DESTINATIONS`: the 14 featured cities, the sourced train and bus cities, and holiday places, grouped by region. Provenance and open questions are in `docs/reference-data.md`, "Villa destinations".

## CIP evidence (researched 21 Nov 2026)

| Option | What we say | Label | Source |
|---|---|---|---|
| CIP terminal | Separate terminal for international flights. Departure: staff handle check-in, baggage and boarding pass, car to the aircraft. Arrival: visa-on-arrival help and transfers. | DOCUMENTED | ikac.ir/fa-IR/airport.ikac/5052 (updated about Feb 2025) |
| Business Lounge, regular and full | Departure only. Dedicated security and passport route; you check bags at the airline counter; "full" adds food and drinks. | DOCUMENTED | ikac.ir/fa-IR/airport.ikac/5072 |
| Home check-in | Departure. Bags collected and checked in at your address. | DOCUMENTED (operator named by the airport) | cipikia.co |
| Suite, transfer | Priced add-ons; details confirmed by staff | DOCUMENTED as priced items | ikac.ir 5052 |
| Fast track | "Subject to confirmation" | UNCONFIRMED (agency and sponsored articles only) | digiato.com (promoted), flytoday.ir |
| 4-hour lead time, under-2s free, companions at their own rate | Stated on the page (soft warning, not a block) | DOCUMENTED | ikac.ir 5052 |

Open: the documents CIP needs (none collected), transit CIP, whether the Feb 2025 page still holds, and the airport.ir view. The `services.cip.enabled` flag (off by default) and the `CIP:IKA` REVIEW policy are unchanged.

## Checks run (21 Nov 2026)
- **Typecheck:** `tsc --noEmit` clean for apps/web, apps/api, packages/contracts, packages/i18n and packages/db. The API production build is clean.
- **Unit tests:** contracts `services.spec` 9/9 (CIP options, documentIds); i18n 23/23 (incl. the Persian date order); api unit 324/324.
- **API e2e:** `services.e2e.ts` 11/11, including the new "documents must be the customer's own" and "departure-only CIP options refused". The test now turns `loyalty.enabled` on for the club rule and restores it.
- **Staff email:** Mailpit received "New visa request · UT-S-…" at the on-duty admin, with the body linking `http://admin.localhost:4200/services/<ref>`.
- **Web Playwright `service-flows.spec.ts`:** 23/24, run against the 14:21 build.
  - Passed: cargo, CIP, Persian route search with a Jalali calendar, keyboard-only Select and Combo, axe on 9 pages in en and fa.
  - Failed: the visa test. Searching "Turkey" found nothing (the list says "Türkiye"). Fixed with country aliases; needs the next web build to confirm.
- **Screenshots** at 360, 768 and 1280, en and fa, for cargo (steps 1 and 3), visa, CIP, trains (and the date picker), stays: no horizontal overflow (checked programmatically) and RTL mirrored. Two visual fixes came from them: the Persian date order and the cargo number spinners.
- **Existing web specs** (browse-open, site-menu, stays, a11y and others): the redesign failures (axe `aria-allowed-attr` and contrast on the trains and buses pickers) are fixed. Other failures came from the shared environment (OTP 429, hotel flag toggled by peers, no future-dated flight results, trace folder collision) and were not re-run on a quiet stack.
- **Not run:** `flight-results.spec.ts` (it skips: every stored `flight_results` row is in the past locally), visual baselines, and Flutter (no mobile change; ADR-0026).

## Notes for deploy
- Run `pnpm db:seed` (insert-or-ignore) so the `service_request.new` templates exist.
- Admins need a verified email and on-duty status to receive the email.
- `next build` on Next 16.4.2 ends with "SecurityFatalError: Your version of Next.js is affected by a known security vulnerability" after writing `.next/BUILD_ID`. An upgrade needs the owner's decision and is not part of this stage.

## Open
- **Owner:** confirm the CIP documents required, and whether fast track should be offered at all.
- **Reviewer:** check the Persian spellings of the new villa places, and whether villages and ski areas belong in the list.
- **Possible follow-ups:**
  - Airline names on result cards: public results carry codes only; a reference-data lookup would add names.
  - Server-side paging if result sets grow past a few hundred rows (ADR-0041 consequences).
  - `peekDraft` in `lib/form-draft` and an exported review step id in `Wizard`, to remove the visa and CIP draft workarounds.

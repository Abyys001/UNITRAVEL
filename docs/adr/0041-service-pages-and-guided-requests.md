# ADR-0041 · Customer service pages: one form kit, guided requests, paged flight results

Status: accepted. Requested by the owner on 21 Nov 2026 (brief "Task 3: Redesign All UniTravel Service Pages and Request Flows"); plan approved the same day. Stage record: `docs/stages/STAGE-32.md`.

ADR-0015 (service requests), ADR-0020 (CIP held by policy), ADR-0021 (curated listings), ADR-0033 (visa checker) and ADR-0034 (catalog served from stored snapshots) stay in force.

## Context
- **Native controls.** Flights has custom controls: the `Calendar` (Jalali-aware), a searchable destination combobox and a passenger counter. Hotel, Trains/Buses, Visa, CIP, Insurance, Tours and Cargo use native date, number and select inputs, and native date inputs cannot show the Jalali calendar. (OBSERVED)
- **DESIGN.md.** It listed `NativeSelect` as "native on purpose". (DOCUMENTED)
- **Long forms.** Cargo is one long six-section page. Visa and CIP are flat forms. (OBSERVED)
- **Flight results.** The results page renders every stored result in one list. `/v1/flights/search` has no paging or total count, and public results carry no price (Phase A). (OBSERVED)
- **Staff notifications.** Staff get INBOX and PUSH for a new service request, but no email. (OBSERVED)
- **Documents.** Documents can only be added to a service request after it is created. (OBSERVED)
- **CIP services at IKA.** The airport operator's site (ikac.ir CIP and Business Lounge pages) and the operator it names (cipikia.co) list the CIP terminal, the Business Lounge in two tiers, home check-in, suites and transfers. "Fast track" appears only in agency and sponsored articles. Evidence table: STAGE-32. (DOCUMENTED / UNCONFIRMED)

## Decisions

| # | Decision |
|---|---|
| D1 | **Shared form kit.** The customer site uses one form kit (`apps/web/src/components/form/`): FieldShell, DateField, DateRangeField, CounterField, SelectField (Base UI `Select` from `@unitravel/ui`), ComboField, Wizard, ReviewList and ConfirmationPanel. Native date, number and select inputs are retired on customer pages. The console keeps `NativeSelect`. This supersedes the DESIGN.md "native on purpose" row for the customer site. |
| D2 | **Guided requests.** Cargo, Visa and CIP become step-by-step wizards over the existing contracts and endpoints. Each step is checked against its slice of the same Zod schema on the client; the server stays the authority. Drafts use the existing `lib/form-draft` (sessionStorage, 1 h), so no personal data goes into localStorage. |
| D3 | **Paged flight results.** Results are filtered (stops, airline, departure window, sort) and paged (10 per page) on the client, over the existing stored-snapshot response. State lives in the URL. No contract change, no provider call, and no price filter, because public results carry no price. |
| D4 | **Additive contract changes.** `CipDetails.services?` (`CipService` enum) and `companions?`. Departure-only options (Business Lounge, home check-in) are refused on arrivals. `CreateServiceRequestBody.documentIds?` (up to 10) is attached at create through the same `documents.attach` ownership check as customer messages (a foreign id returns 404), with a thread note. No migration. |
| D5 | **Staff email.** The default notification matrix row `service_request.submitted` / ON_DUTY_ADMINS gains EMAIL. Environments that already store a matrix keep their row until an authorised user changes it in the Developer Panel; this is noted in STAGE-32, and the stored config is not altered by code. |
| D6 | **CIP copy.** Options backed by the operator's pages are described plainly. FAST_TRACK is offered as "subject to confirmation". No prices are shown, and every option is a wish for staff to confirm, not a booking. The `services.cip.enabled` flag and the `CIP:IKA` REVIEW policy are unchanged. |
| D7 | **Villas destinations.** The list grows from 14 to the Iranian cities in the sourced ground list, plus established coastal and holiday destinations, with provenance in `docs/reference-data.md`. No properties or availability are invented; listings still come only from staff-curated rows. |
| D8 | **Visa copy.** Visa pages never present approval or eligibility as guaranteed. The intro, the review step and the confirmation say that the issuing authority decides. |

## Consequences
- One place to fix control behaviour (RTL, Jalali, keyboard, touch target) for every customer form.
- Mobile (Flutter, paused under ADR-0026) is not changed.
- If result sets grow past a few hundred rows per search, paging should move server-side (a contract change with a total count).

# Stage 0 register: commercial, legal and discovery

Source: booklet ch. 31.2 (Stage 0 workstreams and gate), ch. 34 (open questions and unknowns), ch. 34.1 (decisions owed), ch. 4.8 (questions for counsel). Written 23 Oct 2026.

Stage 0 is work for people outside the repository (contracts, counsel, regulators). It cannot be completed by building software. This register records every item, its status and what the code does in the meantime.

Status values: **BLOCKED** (needs an external party before it can proceed), **UNKNOWN** (a fact nobody has supplied; the booklet marks it UNKNOWN or does not specify it), **DOCUMENTED** (decided or written down; no code needed), **DONE-IN-CODE** (implemented as configuration or code that can be changed later).

Gate (ch. 31.2): counsel's written position on D-01, payments/ATOL and cargo; at least one flight provider with sandbox access. **Gate not met**: the FAKE adapter stands in for sandbox suppliers for local and test use only.

## A. Workstreams (ch. 31.2)

| # | Item | Status | What the code does meanwhile |
|---|---|---|---|
| A1 | Amadeus Enterprise: read-only discovery of the Flight Builder panel; Enterprise API questions (ch. 6); contract and sandbox, or decision to use another GDS | BLOCKED | Adapter `amadeus-enterprise` present, disabled by default, reports BLOCKED/CONTENT_RESTRICTED until a contract exists; the engine skips disabled providers. Seat maps for the contract: UNKNOWN (ch. 34.4) |
| A2 | Duffel: test account; written confirmation that the customer profile is acceptable | BLOCKED | Duffel adapter implemented (search, price, seat maps), disabled by default; needs credentials (Developer Panel, write-only) and the written acceptance before enabling. Sanctions terms and airline list: UNKNOWN (ch. 34.4) |
| A3 | FAKE supplier for development and tests | DONE-IN-CODE | FAKE adapter, local/test only; refused in production (build and `PATCH /v1/dev/providers/fake` reject `environment: production`; production image smoke test confirms) |
| A4 | Counsel: answers to ch. 4.8; initial carrier policy list; ATOL mode; cargo lanes position | BLOCKED | See section B |
| A5 | Vendors: SMS routes (+98 and international), email, hosting region; sanctions clauses reviewed | UNKNOWN | SMS router with failover is built (see section C); no vendor is contracted |
| A6 | Data protection: ICO registration; DPIA started; processor agreements | UNKNOWN (registration, agreements); DOCUMENTED (DPIA draft) | Draft in docs/compliance/DPIA-draft.md; field encryption, audit, retention schedule as data |
| A7 | Product: brand assets | DONE-IN-CODE | Created in this build (assets from the build, Canva); owner approval owed |
| A8 | Product: Persian copy owner | UNKNOWN | Persian strings exist in `packages/i18n` and 190 notification templates (en/fa); no named reviewer; wording is unreviewed |
| A9 | Product: business hours and team rota | DONE-IN-CODE | Configurable in the Developer Panel; defaults London Mon-Fri 09:00-18:00 and Tehran Sat-Wed 09:00-17:00 (U-5 defaults); real rota UNKNOWN |

## B. Counsel questions (ch. 4.8, 34.2)

All ten are unanswered. No counsel position has been recorded, so nothing below may be treated as legal advice.

| Q | Question (short) | Status | What the code does meanwhile |
|---|---|---|---|
| 1 | Selling itineraries from Iran | BLOCKED | Iranian-origin requests are accepted as requests for review; search offers gateway and hub options; policy gates apply |
| 2 | Carriers beyond designated Iranian airlines (waivers) | BLOCKED | Carrier policies in `compliance_policies`: key `country:IR` = BLOCK plus each Iranian airline code = BLOCK, marked `seededPendingCounsel` |
| 3 | Exposure when a carrier is later designated; existing bookings | BLOCKED | Policy changes are data, versioned and audited; no retroactive logic |
| 4 | Payment methods and banks | BLOCKED | No online payments (D-03). Payment status recorded manually; four-eyes verification; no payment implies booking |
| 5 | Iranian SMS provider contracting; transfer risk assessment | BLOCKED | Router sends `+98` only via Kavenegar then SMS.ir; international vendors cannot be added to `+98` |
| 6 | ATOL mode and wording | BLOCKED | Mode `PAY_ON_TICKETING` implemented as config; wording is placeholder pending counsel |
| 7 | Cargo: brokering, lanes, goods, personal effects | BLOCKED | Lanes GB-IR, IR-GB, DE-IR disabled with compliance approval required; `IR:*` lane policy REVIEW; `IR:EXCESS_BAGGAGE` BLOCK; goods categories and keywords seeded as starting proposals (ch. 14.4); partners' compliance status gates booking |
| 8 | Screening lists, thresholds, evidence retention | BLOCKED | Live UK/OFAC/EU lists every 6 hours; matcher threshold from compliance settings; retention proposal in ch. 28.6 |
| 9 | Vendor sanctions clauses | BLOCKED | No vendor contracted; see A5 and F |
| 10 | Consumer law information, cancellation, complaints | BLOCKED | Terms version recorded at sign-up; wording owed |

D-01 (carriers): counsel's position is represented as compliance policy data (above) awaiting sign-off. It is not hard-coded; weakening it in code is forbidden (CLAUDE.md).

## C. Decisions owed by Uni Travel (ch. 34.1)

| # | Decision | Default used | Status | What the code does meanwhile |
|---|---|---|---|---|
| U-1 | Engineering Kit and approved additions | Recorded stack + proposals | DOCUMENTED | ADR-0001 (stack), ADR-0002 (Flutter replaces Expo). Owner approval of ADRs: owed |
| U-2 | Company details: registration, IATA status, ATOL position, Amadeus office ID | UK Ltd, Amadeus agency, no ATOL | UNKNOWN | ATOL position: see ATOL row below. Office ID and IATA status absent from config |
| U-3 | Target markets and first destinations | UK, then DE/NL/FR | DONE-IN-CODE | Hub tables and provider markets are configuration; seeded corridor TR/AM/IR/GB/EU |
| U-4 | Service fee policy and quote currency | GBP; fee entered per quote | DONE-IN-CODE | Fee entered per quote in GBP; policy rules not defined |
| U-5 | Business hours and staffing | London 09-18, Tehran 09-17 | DONE-IN-CODE | See A9 |
| U-6 | Brand assets, Persian copy owner, tone | Neutral | DONE-IN-CODE (assets), UNKNOWN (owner, tone) | See A7, A8; neutral tone used |
| U-7 | Who holds the compliance-officer role | none | UNKNOWN | Role `compliance` exists; demo user only; compliance cases wait for a human |

## D. Payments and ATOL

| Item | Status | What the code does meanwhile |
|---|---|---|
| D-03: no online payments in v1 | DOCUMENTED | Payments are recorded (status, reference, verification), not collected |
| ATOL mode | UNKNOWN (which mode applies) / DONE-IN-CODE (mode `PAY_ON_TICKETING`) | Payment taken only at ticketing; `record_tickets` requires PAID or owner-approved credit override |
| ATOL wording on quotes/receipts | BLOCKED | Not published |

## E. Messaging and reachability

| Item | Status | What the code does meanwhile |
|---|---|---|
| SMS vendor contracts (Kavenegar, SMS.ir, Sinch, Infobip): contracting route, payment, template approvals, delivery-report formats, price per segment, sanctions terms, EU data residency | UNKNOWN | Router, failover, per-route stats, delivery-report webhooks (`/v1/webhooks/sms/:provider`) built; dev sink captures SMS locally; production credentials absent |
| Push inside Iran (Expo, Pushy, APNs reachability) | UNKNOWN | Pushy evaluated; push is best effort; SMS plus in-app polling are the fallback for anything critical (ch. 34.4 Stage 4 pilot owed) |
| Email vendor (Brevo, Mailjet fallback) | UNKNOWN | Email channel built; local Mailpit |
| Hosting region and provider; CDN | UNKNOWN | Docker Compose + Caddy topology (infra/compose.prod.yml); reachability from Iran untested |
| App stores (Cafe Bazaar, Myket, Android developer verification) | UNKNOWN | Flutter web build tested; no store submissions |
| Timatic eligibility and price | UNKNOWN | Not integrated (booklet: optional, later) |
| OAG/Cirium schedules | UNKNOWN | Not integrated (only if Stage 7 needs) |

## F. Research unknowns that affect behaviour (ch. 34.4)

| Topic | Status | Handling |
|---|---|---|
| Whether Iraqi Airways and SalamAir Iran services appear in Amadeus or Duffel content | UNKNOWN | Sandbox searches owed; manual options are a first-class path |
| Current gateway timetables (Van, Erzurum, Yerevan) | UNKNOWN | Supplier searches once providers are live |
| Flight Builder API existence | UNKNOWN | Not relied on |
| Cargo carrier status for Iran (DHL, UPS, Aramex...) | UNKNOWN | Service availability register seeded: Royal Mail/Parcelforce, FedEx, Send My Bag, cargo.one marked SUSPENDED with source URLs; DHL and UPS marked UNKNOWN |
| Exact goods lists (SI 2026/983 schedules); personal effects exception | UNKNOWN | Counsel; starting-proposal policies as data |

## G. Documents the registry points to

- Evidence labels used in the booklet: DOCUMENTED, OBSERVED, INFERRED, REPORTED, UNKNOWN, BLOCKED (ch. 35.1 rule 7).
- Open DPIA actions: docs/compliance/DPIA-draft.md section 7.
- Stage 6 hardening gate items for real people: docs/stages/STAGE-6.md.

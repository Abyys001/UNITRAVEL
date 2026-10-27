# ADR-0015 · Service requests and non-flight verticals behind flags

Status: accepted (owner instruction, 27 Oct 2026: the new site menu). Deviates from D-04 ("v1 is flights only"). Spec: `docs/CONTENT-MENU-LIVE-DATA.md` §4, decisions O6–O10, O8b, O14.

## Context

The owner's menu adds visa (order), tours (call-back), CIP at IKA, travel insurance (request), and listed hotels, villas and stays, trains and buses. D-04 limits v1 to flights. Each item raises an open question: immigration advice is regulated (O6), insurance distribution and UK SI 2026/983 (O7), sanctions on Iranian suppliers and the IKA operator (O8, O9), package travel for tours (O10). No hotel, stay, rail or bus provider is contracted.

## Decision

- **One generic request type**, `service_requests`, instead of four modules. Types `VISA | TOUR_CALLBACK | CIP | INSURANCE | HOTEL | STAY | TRAIN | BUS`; per-type `details` validated by Zod (`packages/contracts/src/services.ts`); references `UT-S-XXXXXX` (same generator as flights).
- **Every type sits behind a flag**, all default **off**: `services.visa.enabled`, `services.tours.enabled`, `services.cip.enabled`, `services.insurance.enabled`, `hotels.enabled`, `stays.enabled`, `trains.enabled`, `buses.enabled`. A flag off answers `FEATURE_DISABLED`, as cargo does. Turning one on is an owner decision recorded with counsel's advice where the spec names counsel.
- **State machine** (`packages/domain/src/service-request.ts`): `SUBMITTED → IN_PROGRESS → QUOTED → CONFIRMED → COMPLETED`, `CANCELLED` (customer only before `CONFIRMED`), `CLOSED_NO_RESPONSE` (system, from `IN_PROGRESS`/`QUOTED`). Interpretations beyond the spec, taken from the flight and cargo machines: `COMPLIANCE_HOLD` when screening returns REVIEW and `DECLINED` for BLOCK or a staff decline; `release_hold` needs `compliance.case.decide`. A `TOUR_CALLBACK` is never quoted and completes from `IN_PROGRESS` (a call, no package sale, O10).
- **Compliance as data**: party screening on submit as for flights, plus a new policy type `SERVICE` with keys `<TYPE>:<context>` (seeded `CIP:IKA` and `INSURANCE:IR` as REVIEW). Nothing is hard-coded.
- **Permissions**: `service_request.read.any` and `service_request.write` (admin, owner; compliance officer reads). Customer routes declare `service_request.create.own` and `service_request.read.own` (customer role) so the route table stays fail-closed; ownership is still checked on every lookup and fails with 404.
- **Quotes**: staff quote with lines (`SERVICE_FEE`, `THIRD_PARTY_FEE`, `CLUB_DISCOUNT`) and a validity; the customer sees amounts only once sent (ADR-0004). Numbered quotations and invoices use the ADR-0006 commercial documents with a new subject `SERVICE`. `PAY_ON_TICKETING` is a flight-ticket rule; payment timing for visa and insurance fees is UNKNOWN (counsel).
- **Verticals** (hotels, stays, rail, bus): ports `AccommodationSupplierAdapter` and `GroundSupplierAdapter` modelled on `FlightSupplierAdapter`, normalised models in `packages/contracts/src/verticals.ts` with tri-state facts and no customer amounts (O8b), `providers.vertical` column. **No adapter is implemented** and no provider id is added until a provider is contracted; until then the pages explain the service is not available and the menu hides the item. Listings are never faked (rule 2).
- **Menu**: `GET /v1/site` (public, cached 60 s) returns which items are on, the support contacts and whether online payment is on. Safar card (O14) is not built.

## Consequences

- One table, one machine and one console queue serve all four services; a later product that needs its own lifecycle (for example a real hotel booking) gets its own ADR.
- With every flag off the deployed product is unchanged except for the menu, tracking and support pages.
- Turning on hotels, stays, trains or buses needs a contracted provider, its adapter, a provider id and counsel's view on serving customers in Iran.

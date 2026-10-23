# Reference data

What `pnpm db:seed` loads, and the licence and provenance position. Booklet: ch. 23.5 (reference data tables and licensing note), ch. 27 (compliance), ch. 14 (cargo), ch. 17 (notifications), ch. 28.6 (retention). Seed code: `packages/db/src/seed/` (`reference-data.ts`, `templates.ts`, `index.ts`). Seeding is idempotent (`ON CONFLICT DO NOTHING`).

## What is seeded

| Data | Source file | Notes |
|---|---|---|
| Countries and cities | `reference-data.ts` (`COUNTRIES`, `CITIES`) | English and Persian names; `region_tags` (for example IR, EUROPE, EU) drive hub tables |
| Airports | `reference-data.ts` (`AIRPORTS`) | IATA, ICAO, English and Persian names, city code, country, IANA time zone, latitude and longitude. Time zone is mandatory: the engine refuses airports without one (ch. 23.5). A curated corridor set (57 rows at 23 Oct 2026): Iranian airports (IKA, THR, MHD, TBZ, IFN...), gateways, hubs and UK/EU destinations |
| Airlines | `reference-data.ts` (`AIRLINES`) | IATA, ICAO, 3-digit accounting code for ticket-number validation (null where not known), name, country. Includes Iranian carriers (country IR), used to derive carrier BLOCK policies |
| Aircraft types | `reference-data.ts` (`AIRCRAFT`) | Display only |
| Roles and permissions | `seed/index.ts` | Built-in roles (owner, admin, cargo admin, compliance officer, developer, customer) with the default permission sets from `packages/contracts` |
| Configuration v1 | `seed/index.ts` | Published version 1 of each config domain (ENGINE_RULES, HUBS, WORKFLOW, NOTIFICATION_MATRIX, AUTH) from `packages/contracts/src/defaults.ts` ("Booklet v1.0 defaults"); feature flags with owner and remove-by; app settings including business hours |
| Notification templates | `templates.ts` | 190 rows: per event, English and Persian, with in-app/push, SMS and email variants. Wording is a starting point; Persian copy has no named reviewer yet (STAGE-0 register) |
| SMS routes | `seed/index.ts` | `+98` -> Kavenegar, SMS.ir; `default` -> Sinch, Infobip. No credentials are seeded |
| Providers | `seed/index.ts` | `fake` (environment `test`, enabled, local and tests only), `duffel` and `amadeus-enterprise` (disabled until contracts and credentials), `manual` (staff-entered). Limits per provider are placeholders until contracts fix them |
| Compliance policies | `seedCompliance` | D-01: `country:IR` = BLOCK and each Iranian carrier code = BLOCK; goods categories (prohibited = BLOCK, sensitive = REVIEW, ordinary = ALLOW); keyword lists in English and Persian; lane policies `IR:*` = REVIEW and `IR:EXCESS_BAGGAGE` = BLOCK. All flagged `seededPendingCounsel`: starting proposals (ch. 14.4), not legal positions |
| Cargo lanes | `seedCargo` | GB-TR, TR-GB, GB-AE, GB-AM enabled; GB-IR, IR-GB, DE-IR disabled and requiring compliance approval, with customer notices in English and Persian. Volumetric divisors 5000 or 6000 |
| Cargo partners | `seedCargo` | Three fictional demo partners, clearly labelled "(fictional)". Real partners are added after due diligence (ch. 14.8) |
| Service availability register | `seedAvailability` (local demo seed) | Rows with sources and status (SUSPENDED, UNKNOWN) for Royal Mail/Parcelforce, FedEx, DHL, UPS, Send My Bag, cargo.one on GB-IR, with source URLs and a check date of 22 Oct 2026. Statements are research notes from the booklet; re-verify before relying on them |
| Demo users (local only) | `seedDemoUsers` | Seeded only when `APP_ENV=local`: fictional people with `.example` addresses and reserved phone ranges, staff TOTP factor with the documented demo secret (docs/LOCAL-DEV.md) |

Not seeded: sanctions lists (fetched live), real suppliers' content, real customers, real partners, Iranian carrier policy approvals by counsel.

## Provenance and licence

The booklet's licensing note (ch. 23.5) requires reference data to be sourced under terms that allow commercial use before production. The status of each source is below; none has been signed off by counsel or the owner.

| Data | Provenance | Status for production |
|---|---|---|
| Airport coordinates, names, ICAO/IATA identifiers | Compiled for this project from public sources (the file header cites public IANA tz data and public airport/airline information). A fuller dataset can be imported by the `reference.sync` job (ch. 26.2) | OurAirports is public domain and is the intended bulk source (PROPOSED). Verify the licence of whichever source is used and record the version and retrieval date |
| IATA and ICAO codes, airline accounting codes | Public knowledge of code assignments, hand-entered | IATA code lists and the Airline Coding Directory are licensed products. Publicly visible codes may be used for identification, but a bulk copy of an IATA dataset may require a licence: UNKNOWN, owner/counsel to confirm. Accounting codes must be validated against a licensed or contractual source before ticket-number validation is relied on in production |
| IANA time zones | IANA tz database (public domain) | OK |
| Country names | Public (ISO 3166 codes) | OK; Persian names compiled by the project: review by the Persian copy owner |
| Sanctions lists | Fetched live every 6 hours from the official publishers: UK FCDO Sanctions List, OFAC SDN and consolidated non-SDN list, EU consolidated list | Official publication terms apply; confirm reuse terms and attribution with counsel. Versions and hashes are stored for evidence (ch. 27.7). Not bundled in the repository |
| Schedules and minimum connection times | Not seeded. OAG and Cirium pricing UNKNOWN; MCT handling to come from Amadeus (ch. 34.4) | Layover rules are configuration (ENGINE_RULES) |
| Timatic | Not integrated | UNKNOWN eligibility and price |
| Notification wording, brand assets | Written or generated in this build | Owner approval owed |

## Maintenance rules
- Add new reference rows through a migration or the seed, never through hand edits in production.
- A new airport needs its IANA time zone. A new airline needs its accounting code when known; leave it null otherwise.
- Policy rows are data (D-01 and others). Changing them in production is a staff action with the approvals defined in the compliance module; do not weaken seeds in code.

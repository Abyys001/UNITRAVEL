# UniTravel

A request-based travel and cargo platform for Uni Travel, serving customers who travel between Iran, its gateway countries (Türkiye, Armenia) and the UK/EU.

**What v1 does:** customers search, request and pay; staff quote, reserve and ticket in their existing tools and record the result. Nothing is shown as booked until it is (booklet ch. 1.2, 2.1). Sanctions compliance is built in as policy data: Iranian carriers are blocked by default (D-01) and Iran cargo lanes start disabled.

**Source of truth:** the implementation booklet, `docs/booklet.txt` (PDF: `UniTravel-Implementation-Booklet-v1.0-DRAFT.pdf`). Departures from the booklet are recorded as ADRs in `docs/adr/` (0001 to 0036).

## At a glance
| | |
|---|---|
| Surfaces | Customer website (`/en`, `/fa` RTL) · Admin Panel · Developer Panel · Flutter app (customer and admin modes, release paused per ADR-0026) |
| Backend | One NestJS API plus a worker (BullMQ jobs), PostgreSQL 18 via Drizzle, Valkey, RustFS (S3), ClamAV |
| Languages | English and Persian in every user-facing feature |
| Payments | Stripe Embedded Checkout in **test mode only**; live is blocked in code until approved. Bank transfer and offline payments are recorded by staff with four-eyes checks |
| Sign-in | Email OTP for customers; staff add TOTP or passkey, with step-up for sensitive actions |
| Status | Stages 1 to 6 and later phases A to J plus stages 18 to 27 built and verified locally. Stage 0 (commercial, legal, discovery) is external work and stays BLOCKED/UNKNOWN |

## Features
- **Flights.** Itinerary engine (connections, hub self-transfers, gateway starts) over pluggable suppliers: FAKE (local/test only), Duffel and Amadeus (disabled pending contracts), manual. A stored flight catalog is refreshed on a budget from Apify Google Flights (indicative, ADR-0029/0034) or FlightAPI.io (ADR-0035), with an Aviation Edge schedule layer (ADR-0036). Customers only see stored snapshots and never trigger a provider call. Customer views carry no supplier prices (ADR-0004).
- **Requests, quotes, bookings.** Domain state machines (`packages/domain`), numbered quotations and invoices with PDFs, direct invoices for visa, bus, train and other services, amendments with compliance re-screening, SLA timers and escalation.
- **Compliance.** UK, OFAC and EU sanctions lists refreshed every 6 hours, name matcher, review cases, and carrier, party, goods and lane policies stored as versioned, audited data.
- **Identity.** Encrypted traveller documents, passport scans in a separate encrypted bucket, audited reveals and downloads, and a verification queue. Ticketing requires verified travellers.
- **Cargo.** Lanes with dual approval, partners, availability register, goods screening, AWB and tracking with append-only corrections.
- **Visa checker.** Requirements database backed by quoted official evidence; anything without that evidence stays unconfirmed (ADR-0033).
- **Customer area.** Request and shipment tracking, billing, support tickets, customer club, service requests, and CMS content (blog, guides, glossary, FAQ, travel rules).
- **Operations.** Hash-chained audit log, permission catalogue with a fail-closed route test, Developer Panel for config, flags, write-only provider credentials and budgets.

## Repository map
| Path | Contents |
|---|---|
| `apps/api` | NestJS API and worker (`main.api.ts`, `main.worker.ts`); OpenAPI at `packages/contracts/openapi.json` |
| `apps/web` | Next.js 16 customer website |
| `apps/console` | Next.js 16 Admin Panel (`admin.*`) and Developer Panel (`dev.*`) |
| `apps/mobile` | Flutter app (ADR-0002) |
| `packages/contracts` | Zod schemas, permissions, error codes, defaults |
| `packages/domain` | State machines, formats, payments, name matcher (no framework imports) |
| `packages/engine` | Itinerary engine (no framework imports) |
| `packages/db` | Drizzle schema, migrations, seed |
| `packages/i18n` | English and Persian catalogues |
| `packages/ui` | Shared React components, design tokens (`tokens/tokens.json` → CSS and Dart) |
| `infra` | Docker Compose (dev, prod), Caddy/nginx, Dockerfile, k6 load test |
| `scripts` | `svc.sh` process control, backup-restore drill, teaser builds |
| `docs` | Plan, stage records, ADRs, runbooks, integrations, DPIA draft, design |

## Quick start
Needs Node 22+, pnpm, Docker. Full guide: [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md).
```bash
cp .env.example .env
docker compose --env-file .env -f infra/compose.dev.yml up -d   # postgres, valkey, rustfs, mailpit
pnpm install
pnpm --filter "./packages/*" run build
pnpm db:migrate && pnpm db:seed
(cd apps/api && npx tsc -p tsconfig.build.json)
scripts/svc.sh start api worker web console    # build web/console first: pnpm --filter @unitravel/web build
```
Start and stop processes only with `scripts/svc.sh` (pid files and logs in `.run/`).

| Service | Local address |
|---|---|
| API | http://localhost:4100 |
| Website | http://localhost:4000/en · /fa |
| Admin Panel | http://admin.localhost:4200 |
| Developer Panel | http://dev.localhost:4200 |
| Mailpit | http://localhost:8035 (SMTP 1035) |
| PostgreSQL · Valkey · RustFS | 5462 · 6390 · 9010 |

**Signing in locally:** every sign-in screen has a *Test sign-in* box (local and `TEST_SIGN_IN=on` only). Seeded users: `owner@`, `sara@` (admin), `cargo@`, `compliance@`, `dev@unitravel.example`, and customer `neda@student.example`.

## Checks
| What | Command |
|---|---|
| Typecheck and unit tests (turbo) | `pnpm check` |
| API e2e (infra up, DB migrated and seeded) | `cd apps/api && pnpm test:e2e` |
| Web Playwright (e2e, axe, headers) | `cd apps/web && pnpm e2e` |
| Mobile | `flutter analyze && flutter test` in `apps/mobile` |
| Load | `k6 run infra/load/search.k6.js` |

## Ground rules
Summary of [CLAUDE.md](CLAUDE.md) and booklet ch. 35.1:
- Never show fabricated, scraped or unverified flights. FAKE data is local/test only.
- Baggage and fare conditions are tri-state; an UNKNOWN value blocks sending a quote. A successful payment does not mean a booking exists.
- Permission and state decisions are made in the backend. Every route declares a permission, and state changes go through the state machines.
- Compliance policies are data changed by authorised staff, never code bypasses.
- Secrets never go in code, commits or logs. Provider keys are write-only in the Developer Panel.
- Contracts and invariant tests change first, and the OpenAPI document, permissions and en/fa strings change in the same commit as the code.

## Open external items
These need people outside the codebase. Details are in [docs/stages/STAGE-0.md](docs/stages/STAGE-0.md).
- Counsel answers (ch. 4.8): Iran-origin sales, carrier waivers, ATOL wording, cargo lanes, vendor sanctions clauses.
- Supplier contracts: Duffel, Amadeus Enterprise. Live Stripe keys. Paid Aviation Edge and FlightAPI keys.
- Pre-launch gates: penetration test, UAT, pilot, DPO review of the DPIA, owner sign-off. The iOS build needs a Mac and an Apple Developer account.

## Documentation
| Topic | Where |
|---|---|
| Plan, stage list, progress log | [docs/PLAN.md](docs/PLAN.md) |
| Stage verification records | [docs/stages/](docs/stages/) |
| Architecture decisions | [docs/adr/](docs/adr/) |
| Providers and configuration | [docs/integrations/PROVIDERS.md](docs/integrations/PROVIDERS.md), [CONFIGURATION.md](docs/integrations/CONFIGURATION.md) |
| Operations, deploy, backups | [docs/runbooks/](docs/runbooks/README.md) |
| Flight catalog operations | [docs/runbooks/flight-catalog.md](docs/runbooks/flight-catalog.md) |
| Data protection | [docs/compliance/DPIA-draft.md](docs/compliance/DPIA-draft.md) (needs DPO/counsel review) |
| Design direction | [docs/design/DESIGN.md](docs/design/DESIGN.md) |
| Reference data | [docs/reference-data.md](docs/reference-data.md) |
| Code map | `graphify-out/` knowledge graph (`graphify query "<question>"`) |

# UniTravel

UniTravel is a request-based travel and cargo platform for Uni Travel, built for customers travelling between Iran, its gateway countries (Türkiye, Armenia) and the UK/EU. One backend serves a customer website, a mobile app (customer and admin modes), an Admin Panel, a Developer Panel, a flight search and itinerary engine (connections, self-transfers via hubs, gateway starts) and a cargo request-and-quote service. In version 1 the platform finds and quotes; staff reserve and ticket in existing tools and record the results, and nothing is shown as booked before it is (booklet ch. 1.2, 2.1). Sanctions compliance is built in: Iranian carriers are excluded by default through policy data (D-01), and Iran cargo lanes start disabled.

Source of truth for scope: the implementation booklet, text copy at `docs/booklet.txt` (PDF: `UniTravel-Implementation-Booklet-v1.0-DRAFT.pdf`).

## Repository map
| Path | Contents |
|---|---|
| `apps/api` | NestJS API and worker (two process roles), Drizzle + PostgreSQL, Valkey/BullMQ; OpenAPI at `packages/contracts/openapi.json` |
| `apps/web` | Next.js customer website, `/en` and `/fa` (RTL) |
| `apps/console` | Next.js Admin Panel (`admin.*`) and Developer Panel (`dev.*`) |
| `apps/mobile` | Flutter app, customer and admin modes (ADR-0002) |
| `packages/contracts` | Zod schemas, permissions, error codes, defaults |
| `packages/domain` | State machines, formats, payments, name matcher |
| `packages/engine` | Itinerary engine |
| `packages/db` | Drizzle schema, migrations, seed |
| `packages/i18n` | English and Persian catalogues |
| `packages/ui` | Shared React components |
| `infra` | Docker Compose (dev, prod), Caddy, Dockerfile, k6 load test |
| `scripts` | `svc.sh` process control, backup-restore drill |
| `docs` | Plan, stage records, runbooks, ADRs, DPIA draft, reference data notes |

## Start here
- Run it locally: [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md)
- Plan and progress: [docs/PLAN.md](docs/PLAN.md)
- Stage records: [Stage 0 register](docs/stages/STAGE-0.md), [Stage 6 hardening](docs/stages/STAGE-6.md)
- Decisions: [ADR-0001 stack](docs/adr/0001-stack-and-monorepo.md), [ADR-0002 Flutter](docs/adr/0002-flutter-mobile.md), [ADR-0003 state machine interpretations](docs/adr/0003-state-machine-interpretations.md)
- Operations: [runbooks](docs/runbooks/README.md)
- Data protection: [DPIA draft](docs/compliance/DPIA-draft.md) (requires DPO/counsel review)
- Reference data: [docs/reference-data.md](docs/reference-data.md)
- Design direction: [docs/design/DESIGN.md](docs/design/DESIGN.md)
- Working rules for AI sessions: [CLAUDE.md](CLAUDE.md)

## Status
Stages 1 to 6 are built and verified locally; Stage 0 (commercial, legal, discovery) is external work and is recorded as BLOCKED/UNKNOWN items. Pre-launch gates that need people (penetration test, UAT, pilot, counsel sign-off, owner approval) are open. See PLAN.md and STAGE-6.md.

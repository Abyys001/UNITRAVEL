# Local development

Everything runs on one machine. Secrets in `.env.example` are local placeholders; production refuses defaults.

## Set-up
```bash
cp .env.example .env
docker compose --env-file .env -f infra/compose.dev.yml up -d      # postgres, valkey, rustfs (S3), mailpit
pnpm install
pnpm --filter "./packages/*" run build
pnpm db:migrate && pnpm db:seed
(cd apps/api && npx tsc -p tsconfig.build.json)     # builds apps/api/dist
scripts/svc.sh start api worker web console mobile
```
`pnpm db:seed` is idempotent. Demo users and the demo staff TOTP secret are seeded only when `APP_ENV=local`.

The `web` and `console` services use `next start`: build them first (`pnpm --filter @unitravel/web build`, same for console). `mobile` serves `apps/mobile/build/web`: build it per `apps/mobile/README.md`.

## Process control
Use `scripts/svc.sh start|stop|restart <api|worker|web|console|mobile>...`. It keeps pid files and logs in `.run/`. **Never use `pkill` patterns**; they can kill unrelated processes. After changing API code, rebuild (`npx tsc -p tsconfig.build.json` in `apps/api`) and `scripts/svc.sh restart api worker`.

`infra/compose.dev.yml` gives RustFS an SSE-S3 master key from `.env` (`RUSTFS_SSE_S3_MASTER_KEY`, generate with `openssl rand -base64 32`; never commit it) because the identity-scan bucket is encrypted at rest (ADR-0005); recreate the storage container after pulling this change: `docker compose --env-file .env -f infra/compose.dev.yml up -d storage` (the volume is kept).

## Ports
| Service | URL / port |
|---|---|
| API | http://localhost:4100 |
| Web (customer, `/en` and `/fa`) | http://localhost:4000 |
| Console, Admin Panel | http://admin.localhost:4200 |
| Console, Developer Panel | http://dev.localhost:4200 |
| Flutter web build | http://localhost:4300 |
| PostgreSQL | localhost:5462 |
| Valkey (Redis protocol) | localhost:6390 |
| RustFS (S3) | localhost:9010 |
| Mailpit | SMTP 1035, UI http://localhost:8035 |

## Demo users (local only)
| Role | Phone |
|---|---|
| Owner | +447700900001 |
| Admin | +447700900002 |
| Cargo | +447700900003 |
| Compliance | +447700900004 |
| Developer | +447700900005 |
| Customers | +989120000001, +447700900010 |

Sign-in uses a one-time code. In local mode SMS goes to a dev sink: read the code from `GET http://localhost:4100/v1/dev-sink/sms`. Push is at `/v1/dev-sink/push`.

Staff also need TOTP. The demo staff TOTP secret (local only, seeded only when `APP_ENV=local`) is `KVXGSVDSMF3GK3CEMVWW6VCPKRIDEMBSGY`; add it to an authenticator app or generate codes with any RFC 6238 tool. Never reuse it anywhere else.

## Tests
| Layer | Command |
|---|---|
| Everything with turbo (typecheck + unit) | `pnpm check` |
| Unit tests, one package | `pnpm --filter @unitravel/domain test` (also engine, contracts, api) |
| API unit | `cd apps/api && pnpm test` |
| API e2e (needs the infra up, migrated and seeded DB) | `cd apps/api && pnpm test:e2e` (53 tests) |
| Web Playwright (e2e, a11y, security headers) | `cd apps/web && pnpm e2e` (needs api and web running) |
| Mobile | see `apps/mobile/README.md`: `flutter analyze`, `flutter test`, `flutter build web --release --no-web-resources-cdn`, then the Playwright smoke test in `apps/mobile/e2e` |
| Load (k6) | `k6 run infra/load/search.k6.js` |
| Backup drill | `scripts/backup-restore-drill.sh` |

If `flutter test` cannot connect to the flutter_tester process, a shell HTTP proxy is probably intercepting (see the mobile README).

## Layout reminders
- `FAKE` supplier is on by default locally and refused in production.
- Config (limits, flags, routes) is editable in the Developer Panel; compliance policies are data, not code.
- API paths: `/v1/...` customer and public, `/v1/admin/...`, `/v1/dev/...` (see `packages/contracts/openapi.json`).

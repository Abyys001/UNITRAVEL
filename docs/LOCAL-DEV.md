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

## Signing in (local only)
Sign-in is email-only (ADR-0010). On every sign-in screen a dashed **Test sign-in (local only)** box reads the code from the local email sink (`GET http://localhost:4100/v1/dev-sink/email`) and fills it in. For staff it also fills the current authenticator code (`GET /v1/auth/dev-sink/totp`). The box only appears when `APP_ENV=local`. Emails also arrive in Mailpit (http://localhost:8035). SMS (phone verification) still goes to `/v1/dev-sink/sms`, and push to `/v1/dev-sink/push`.

**Test sign-in (ADR-0012).** With `TEST_SIGN_IN=on` (the local `.env.example` default; staging opts in; the API refuses to start with it on in production) every sign-in screen also shows a **Test sign-in (testing phase)** box: type or pick an email and sign in without any code. Staff skip the authenticator step. Every use is audited as `user.test_signed_in`.

New customers: sign in with any new email; you then get the profile form. Staff accounts are created through the Admin Panel.

Seeded demo users:
| Role | Email | Phone (contact) |
|---|---|---|
| Owner | owner@unitravel.example | +447700900001 |
| Admin | sara@unitravel.example | +447700900002 |
| Cargo | cargo@unitravel.example | +447700900003 |
| Compliance | compliance@unitravel.example | +447700900004 |
| Developer | dev@unitravel.example | +447700900005 |
| Customer | neda@student.example | +447700900010 |
| Customer (no email, cannot sign in through the UIs) | none | +989120000001 |

The demo staff TOTP secret (local only, seeded only when `APP_ENV=local`) is `KVXGSVDSMF3GK3CEMVWW6VCPKRIDEMBSGY`. The test box makes it unnecessary in the browser. Never reuse it anywhere else.

## Tests
| Layer | Command |
|---|---|
| Everything with turbo (typecheck + unit) | `pnpm check` |
| Unit tests, one package | `pnpm --filter @unitravel/domain test` (also engine, contracts, api) |
| API unit | `cd apps/api && pnpm test` |
| API e2e (needs the infra up, migrated and seeded DB) | `cd apps/api && pnpm test:e2e` |
| Web Playwright (e2e, a11y, security headers) | `cd apps/web && pnpm e2e` (needs api and web running) |
| Mobile | see `apps/mobile/README.md`: `flutter analyze`, `flutter test`, `flutter build web --release --no-web-resources-cdn`, then the Playwright smoke test in `apps/mobile/e2e` |
| Load (k6) | `k6 run infra/load/search.k6.js` |
| Backup drill | `scripts/backup-restore-drill.sh` |

If `flutter test` cannot connect to the flutter_tester process, a shell HTTP proxy is probably intercepting (see the mobile README).

Deploying to a VPS (staging or production): `docs/runbooks/deploy-vps.md`.

## Layout reminders
- `FAKE` supplier is on by default locally and refused in production.
- Config (limits, flags, routes) is editable in the Developer Panel; compliance policies are data, not code.
- API paths: `/v1/...` customer and public, `/v1/admin/...`, `/v1/dev/...` (see `packages/contracts/openapi.json`).

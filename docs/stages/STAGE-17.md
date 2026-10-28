# Stage 17 record: security hardening and operability

Source: owner request of 28 Oct 2026 ("make it really good locking and secure backend and also ready to use"), with the research brief pasted in the same message (§6 auth, §9 security checklist). Decision record: ADR-0017. Booklet chapters: 10.5, 13.7, 16.1, 25.1–25.7, 28.1–28.5, 30.2, 30.6, 32.3.

## How the gaps were found (OBSERVED)

A read-only review in three parts (identity and sessions; object access in the business modules; deployment, Developer Panel and database), each finding traced to a file and line and then checked by hand before changing code. The findings are listed in ADR-0017 "Context". Findings checked and not changed are listed at the end of this record.

## What changed (DOCUMENTED)

**Identity and sessions** (`apps/api/src/modules/identity`, `core/http`)
- `mfa.service.ts`: adding a TOTP or passkey needs a second factor inside the step-up window once any factor is confirmed (`STEP_UP_REQUIRED`); pending factors raise a session only during the first enrolment or after a check; TOTP codes claimed with `SET NX`; WebAuthn challenges single use and per session; `passkeyRpId` = the domain both console hosts share.
- `auth.guard.ts`: `staffGated` keeps only customer permissions for staff on website sessions or before the second factor, on every route (`MFA_REQUIRED` on the console).
- `otp.service.ts`: atomic attempt counting (Lua) and single-use consumption; limit windows checked before any is recorded, the requester's own first. `rate-limit.ts`: `check()` and `ipKey()` (IPv6 /64), used by route limits, OTP and tracking. `track.service.ts`: atomic attempts.
- `sessions.service.ts`: console idle timeout at refresh; `revokeAll`. `access.service.ts`: monotonic permission-version cache with a 5-minute lifetime.
- `POST /v1/me/sessions/revoke-others`; web account page button "Sign out all other devices" / «خروج از همهٔ دستگاه‌های دیگر» (en/fa in `packages/i18n`).
- `TEST_SIGN_IN=customers`; `GET /v1/auth/test-sign-in` returns `staff`; the console hides the box when `staff` is false (`packages/ui`).
- `POST /v1/dev/users/:id/mfa/reset` (privileged permission, step-up, audited `user.mfa_reset`, sessions ended); Developer Panel > Users > "Reset second factor" / «بازنشانی عامل دوم» with a confirmation that asks for an identity check.

**Object access and money**
- `documents.service.ts`: `claimForRequest` / `publish(tx, id, scope)` (request, customer or own unattached upload; never identity scans); used by flight, cargo and service messages, ticket receipts and payment evidence.
- `cargo.service.ts`: `send_quote` quote must belong to the request; re-weigh path needs `cargo_request.transition`, version and a draft. `requests.service.ts`: `mark_reservation_lapsed` needs `reservation.record` or `flight_request.transition` and the version.
- Four-eyes on running totals: `refunds.service.ts` (self-approved refunds per payment), `bookings.service.ts` (self-verified manual payments per request), `loyalty.service.ts` (manual grants per customer per 24 h). A pending refund is always shown as needing a second approver.
- `storage.ts`: upload URLs sign `Content-Length`; `documents.service.ts`: completion checks the stored size, the scan checks magic bytes.
- `search.service.ts`: anonymous searches need their anonymous key. Developer Panel: job retry/discard need `settings.write`; reactivating a privileged account needs `user.role.assign.privileged`; unknown user ids answer 404.

**Data, logs, start-up**
- Migration `0012_append_only_deletes.sql`: `DELETE`/`TRUNCATE` refused on the audit log, status history, compliance decisions and offer snapshots.
- `core/safe-error.ts`: error logs, job failure reasons and the Developer Panel dead-letter list are scrubbed.
- `env.ts` `deploymentProblems()`: placeholder/short secrets, missing `APP_ENV` under `NODE_ENV=production`, and in production an unauthenticated Valkey or http URLs stop start-up. `infra.module.ts`: refuses a superuser or schema-owner database connection outside local. `/ready`: two pings, rate limited.

**Deployment and ready-to-use**
- `infra/compose.prod.yml`: `TRUST_PROXY`, Valkey password, `no-new-privileges`, bounded logs, `cap_drop: [ALL]` for the Node services, `db-maintenance` (`infra/scripts/db-maintenance.sh`: partitions + nightly `pg_dump`, `BACKUP_KEEP_DAYS`).
- `infra/caddy/Caddyfile`: no trusted proxies, `X-Real-IP` set by the edge, HSTS and `nosniff`, storage host limited to the application buckets. Web and console `/api` proxies take the edge-set address.
- `scripts/setup-local.sh` (`pnpm setup`); db scripts read `.env`; `migrate.ts` warns when a role URL is missing; `packages/db/src/create-owner.ts` (`pnpm db:create-owner`, or `node dist/create-owner.js` in the seed image).
- `scripts/vps-deploy.sh`: generates `REDIS_PASSWORD` (also appends it to older env files), `status` shows the last maintenance run and warns about `TEST_SIGN_IN`.
- Docs: ADR-0017, ADR-0012 status, `docs/LOCAL-DEV.md`, `docs/runbooks/deploy-vps.md`, `deploy-vps-nginx.md`, `backup-restore.md`, `infra/.env.prod.example`. OpenAPI regenerated (205 paths).

## Verification (OBSERVED, local stack, 28 Oct 2026)

| Check | Result |
|---|---|
| API typecheck incl. tests (`tsc -p tsconfig.json --noEmit`); web, console, ui, contracts typecheck | 0 errors |
| API unit (`pnpm test`) | 85/85 (new: env preflight, error scrubbing, IPv6 keys, passkey domain). `live-data.spec.ts` was failing before this stage whenever the local `.env` had `TEST_SIGN_IN=on`; it now pins the value |
| db 4/4, i18n 12/12 | pass |
| New `test/security.e2e.ts` | 11/11, four consecutive runs clean. Run against the pre-change API, 8 of its first 10 tests failed as intended (the website-session and readiness checks already passed) |
| API e2e, every file run on its own | 19/20 files fully green; `security.e2e.ts` had 1 failure in that sweep while a browser test against the same stack deleted the demo staff's pending sign-in codes, then 11/11 twice when run alone |
| API e2e, whole suite in one run | not green, before or after this stage: repeated demo staff sign-ins hit the OTP resend cooldown and the TOTP verify limit (429). Earlier stage records ran affected files on their own for the same reason. Both runs here show this pattern; every failure in the final whole-suite run was such a 429 except two that this stage caused and fixed (`reactivate` answered 401 for an unknown id; the test-sign-in status gained `staff`) |
| `stage11.e2e.ts` (Stripe test mode, refunds) | 10/10, now including a split-refund case |
| Web Playwright `customer.spec.ts` + `identity.spec.ts` (security headers, browser pre-signed upload with the signed length, test sign-in box) | 10/10 |
| Browser check of the account page | en "Other devices signed out: 1", fa «خروج از دستگاه‌های دیگر: ۱», RTL |
| Migration 0012 on the dev database | DELETE and TRUNCATE on `audit_log` refused |
| `create-owner` on a fresh staging-like database | creates the owner; a second run is refused (exit 1); bad input exits 2 |
| `scripts/setup-local.sh` from a stopped stack | ready, API `/ready` true |
| `docker compose ... config` for `compose.prod.yml` and with `compose.vps.yml`; `caddy validate` | valid |

Not run: console Playwright (the Developer Panel reset button was checked by typecheck only), Flutter, the production images (`docker compose build`), a real VPS deploy, k6.

## Checked and not changed (INFERRED or out of scope)

- `__Host-` cookie prefixes: every client reads the cookie names; low risk with host-only cookies.
- Audit hash coverage of ip/user agent/request id and exporting the chain head off the host: needs a hash version 3 and a destination; recorded in ADR-0017.
- Object storage still uses the store's root keys (scoped user needs RustFS policy work); its admin API is no longer routed publicly by Caddy.
- Images pinned by tag, not digest; the mobile image runs as root.
- External penetration test, DAST against staging, DPIA sign-off: people's work (ch. 28.7), still open.
- `TEST_SIGN_IN=on` on the owner's staging (`scripts/vps-deploy.sh` writes `on` for new hosts, as decided in ADR-0012): unchanged pending the owner's choice; `customers` is available.

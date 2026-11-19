# ADR-0017 · Security hardening and operability (October 2026 review)

Status: accepted (owner request, 28 Oct 2026: "make it really good locking and secure backend and also ready to use"). Record: `docs/stages/STAGE-17.md`.

## Context

A read-only review of the API, the deployment files and the Developer Panel (booklet ch. 25, 28, 30, 32.3) found gaps that the existing tests did not cover. The most serious, all OBSERVED in code:

- A staff session that had passed only the sign-in code could enrol a new authenticator and verify it, which lifted the session past the staff second factor and the step-up check (ch. 16.1, 25.5).
- Staff permissions in the token were usable on `@Authenticated` routes from a website session or before the second factor.
- OTP verification read, checked and wrote its attempt counter in separate steps, and consumed the code without a condition, so parallel guesses shared one attempt and one code could sign in twice (ch. 25.1). The per-number request limits were recorded before the caller's own limits were checked, so anyone could fill a victim's window and lock them out.
- Staff routes accepted object ids that did not belong to the request in the URL: a cargo quote id from another request, and documents (including identity scans) re-owned or published to another customer.
- The 10 MB upload limit was advisory (the store accepted any size), and file content was not checked against the declared type (ch. 28.1).
- The Caddy deployment never set `TRUST_PROXY`, so every user shared one IP rate-limit budget; Caddy trusted `X-Forwarded-For` from private addresses, which a client behind Docker's userland proxy can be; Valkey had no password; the store's admin API was public; `CHANGE_ME` secrets were accepted on deployed hosts; nothing ran partition maintenance or backups; a first owner could not be created on a deployed host without hand-written SQL.

## Decision

Identity and sessions
- Adding a second factor (TOTP or passkey) needs a second-factor check inside the step-up window once any factor is confirmed. A pending factor only raises a session when no factor is confirmed yet (the first-enrolment bootstrap) or the session already passed one. TOTP codes are claimed with `SET NX`; WebAuthn challenges are single use (`GETDEL`) and bound to the session. The passkey relying party is the domain both console hosts share (`unitravels.co.uk`, not `co.uk`).
- The guard keeps only customer permissions for a staff account on a website session (`staffGated: "web"`) or before its second factor (`"mfa"`, answered with `MFA_REQUIRED`), on every route.
- OTP and tracking-code attempts are counted by one Lua script before the comparison; the winner deletes the challenge and the database row is consumed with `consumed_at IS NULL`. All OTP request windows are checked before any is recorded, the caller's own (IP, network, device) first. IPv6 clients are keyed by /64.
- The console idle timeout also applies at refresh. The cached permission version only moves up (Lua max) and expires after 5 minutes. `POST /v1/me/sessions/revoke-others` signs out every other session (web account page: "Sign out all other devices" / «خروج از همهٔ دستگاه‌های دیگر»).
- `TEST_SIGN_IN` gains a third value, `customers`: email-only sign-in for customer accounts while staff still need a code and their second factor. `on` keeps its ADR-0012 meaning; production refuses anything but `off`. `GET /v1/auth/test-sign-in` now also returns `staff`.

Object access and money
- `DocumentsService.claimForRequest` / `publish` accept a document only if it is already on that request, owned by its customer, or an unattached upload by the same staff member, and never an identity scan; used for messages, ticket receipts and payment evidence.
- Cargo `send_quote` requires the quote to belong to the request; the re-weigh path also requires `cargo_request.transition`, the request version and a draft. `mark_reservation_lapsed` requires `reservation.record` or `flight_request.transition` and the request version.
- Four-eyes thresholds count the running total (refunds per payment, self-verified manual payments per request, manual club grants per customer over 24 hours), so splitting an amount no longer avoids the second person.
- Upload URLs sign `Content-Length` (the exact declared size); completing an upload checks the stored size; the scan refuses content whose magic bytes do not match the declared type.
- An anonymous search is readable only with the anonymous key that started it. Developer Panel job retry and discard need `settings.write`; reactivating a privileged account needs `user.role.assign.privileged`.

Data and logs
- Migration 0012: the append-only tables (audit log, status history, compliance decisions, offer snapshots) also refuse `DELETE` and `TRUNCATE`.
- Error logs and job failure reasons go through `safeError` / `scrubMessage`: database parameters are cut and emails and numbers are masked.

Start-up and deployment
- Outside `APP_ENV=local` the API refuses to start on placeholder (`CHANGE_ME`, the local development values) or short secrets, on a production image without an explicit `APP_ENV`, and in production on an unauthenticated Valkey or non-https public URLs. It also refuses a database connection as a superuser or the schema owner.
- `/ready` pings PostgreSQL and Valkey only, and is rate limited.
- `infra/compose.prod.yml`: `TRUST_PROXY` set for the Docker network, Valkey `--requirepass`, `no-new-privileges` and bounded logs on every service, `cap_drop: [ALL]` on the Node services, and a `db-maintenance` service (owner role) that runs partition maintenance and a nightly `pg_dump` into the `backups` volume. Caddy trusts no forwarded headers, sets `X-Real-IP`, adds HSTS and `nosniff` everywhere, and routes the storage host to the application buckets only. The web and console `/api` proxies take the edge-set client address, not the first `X-Forwarded-For` entry.
- Ready to use: `scripts/setup-local.sh` (`pnpm setup`) goes from a clone to a running local stack; `pnpm db:*` scripts read `.env`; `node dist/create-owner.js --email …` creates the first owner on a deployed host and refuses when one exists; `scripts/vps-deploy.sh` generates `REDIS_PASSWORD` (also for hosts deployed earlier) and warns about `TEST_SIGN_IN` in `status`.

## Consequences

- Deployed hosts whose `.env.prod` still holds placeholders stop at start-up with a list of what to fix; hosts created by `scripts/vps-deploy.sh` already meet the rules.
- A staff member who loses their only authenticator needs an owner to remove the factor (Developer Panel); they can no longer re-enrol from a code alone.
- Backups now exist on the host. Copying the `backups` volume off the host, WAL archiving and point-in-time recovery remain production work (`docs/runbooks/backup-restore.md`); the key custody is the operator's.
- Not changed, still open: `__Host-` cookie prefixes (would touch every client), audit hash coverage of ip/user agent and export of the chain head off the host, a scoped storage user instead of the store's root keys, image digests, and an external penetration test (ch. 28.7).

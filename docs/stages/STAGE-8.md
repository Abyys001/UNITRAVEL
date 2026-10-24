# Stage 8 record: Phase B, identity, profile, passport, verification

Source: `docs/ADDITIONAL-REQUIREMENTS.md` (Phase B, owner decisions 4, 7, 9), `docs/adr/0005-identity-verification.md`, booklet ch. 10.3, 11.6, 15.2, 25.6, 28.1, 28.3, 28.6, 35.1 rules 3, 4, 6 and 10. Measured locally on 23 Oct 2026.

## What changed (DOCUMENTED)
- ADR-0005 records the verification model, the passport-scan pipeline, the download rule, retention and the grants.
- Domain: `packages/domain/src/identity-verification.ts` (state machine `UNVERIFIED → SUBMITTED → VERIFIED | REJECTED | CORRECTION_REQUIRED`, `material_change` VERIFIED → SUBMITTED, material-field helpers, canonical text for the confirmed hash) and the `record_tickets` guard (`allTravellersVerified`).
- Contracts: `VerificationStatus`, `VerificationDecision`, `VerificationReasonCode`, `PASSPORT_SCAN` document type and `IDENTITY_DOCUMENT_TYPES`, `CustomerVerification` on `TravellerView`, `MyDetails`, `UpdateDetailsBody`, `AddressInput`, staff queue/detail/decide schemas, error code `IDENTITY_NOT_VERIFIED` (409), permission `identity.verify`, setting `identityScanRetentionDays`, notification events `identity.verification_{verified,rejected,correction}`, `AddIdentityBody.challenge`.
- Database (migration `0004_identity_verification`, journal entry added by hand like 0003): address columns on `customer_profiles`; `verification_status`, `scan_document_id`, `customer_confirmed_at`, `confirmed_values_hash`, `submitted_at`, `verified_at` on `traveller_documents`; `storage_bucket` and `erased_at` on `documents`; insert-only `verification_reviews` (trigger plus no UPDATE/DELETE grant for `app_rw`); `identity.verify` granted to `admin` and `owner` with a `perm_version` bump. Seed: templates (en/fa, 3 events) and role grant.
- API: customer `GET/PATCH /v1/me/details`, `POST /v1/me/travellers/:id/identity/scan` and `/identity/confirm`; staff `GET /v1/admin/verifications`, `/:id`, `/:id/scan` (inline, sandboxed, audited), `POST /:id/decide`. Uploads of identity types go to the `<bucket>-identity` bucket with SSE-S3, JPEG/PNG only; the scan worker strips metadata (`image-sanitise.ts`) before `CLEAN`. Download route: identity documents need `customer.read.documents`; every staff download is audited (`document.downloaded`). Retention job `identity.scan-retention`. Traveller edits re-evaluate verification (material change). Account and traveller deletion erase scans. Notification router sends the decision to the customer.
- Web (`/en`, `/fa`): `/account/details` (contact methods with add-and-verify, profile, optional address, passport scan upload and review-then-confirm), verification badge on the account page, inline add-and-verify phone on the request form. Console: Passport verification queue and side-by-side compare view (scan, fields, audited Reveal, decision with reason code and message), customer context shows the status. Flutter: `DetailsScreen` with the same flow, link on the account screen, inline phone verification on the request form.
- OpenAPI regenerated (`packages/contracts/openapi.json`, 144 paths).

## Evidence labels for the storage facts
- OBSERVED: RustFS 1.0.1 at :9010 rejects any SSE-S3 write until `RUSTFS_SSE_S3_MASTER_KEY` is set (`InvalidRequest: SSE-S3 requires RUSTFS_SSE_S3_MASTER_KEY ...`). With a key (local placeholder in `infra/compose.dev.yml`; the storage container was recreated, its volume kept), `PutObject` with `ServerSideEncryption: AES256` succeeds, `HeadObject` returns `AES256`, `PutBucketEncryption` and `GetBucketEncryption` work, and a write with no SSE header into a bucket with the default rule also reports `AES256`.
- OBSERVED (e2e): an upload with the signed SSE header is accepted; the stored object has the EXIF/XMP bytes removed after the scan; `documents.storage_bucket` ends in `-identity`.
- UNKNOWN: whether the production object store supports SSE-S3 with a managed key (hosting not chosen). Browser PUT to RustFS depends on the store's CORS rules for the `x-amz-server-side-encryption` header: not tested in a browser.
- UNKNOWN: retention period for scans (owner decision 7). Setting exists, default unset, job inactive until set.

## Verification
| Check | Result | Label |
|---|---|---|
| Typecheck: contracts, domain, engine, db, i18n, ui, api, web, console | 0 errors | OBSERVED |
| Unit: domain 33 (verification property tests: VERIFIED only from SUBMITTED by staff with `identity.verify`, clean scan, current confirmation and not self-review; SUBMITTED only by the customer; a customer can only reach SUBMITTED; material-field diff and hash ignore a Persian-name edit; `record_tickets` needs verified travellers), engine 7, api 24 (metadata stripping of JPEG/PNG, serialiser property tests for the customer verification view: no reviewer, no value hash, no storage key, number only as last 4, reason only in REJECTED/CORRECTION_REQUIRED; route table pins the new permissions) | all pass | OBSERVED |
| API e2e, new file `test/stage8.e2e.ts` (4 tests): My details with address validation; add and verify an email through `POST /v1/me/identities` + Mailpit code; scan upload (PDF refused, EXIF removed, identity bucket), foreign attach 404, stale confirm 409, queue, customer/compliance 403, Reveal, audited download, developer and other-customer 404, a role with only `flight_request.read.any` gets 404, inline scan view audited, correction with reason, Persian-name edit not material, resubmit, stale reviewer 409, verify, material change back to SUBMITTED, replaced scan deletes the old one, insert-only reviews; `record_tickets` blocked with `IDENTITY_NOT_VERIFIED` until VERIFIED while quote acceptance is not blocked | 4/4 | OBSERVED |
| API e2e, full run (`pnpm test:e2e`): 7 files, 53 tests incl. the permission matrix covering the 4 new staff routes and route fail-closed | first full run 52 pass, 1 fail in `stage3` on an OTP request (`OTP_INVALID` while signing a staff session in); the re-run of that file alone 10/10. The final full run hit the resend cooldown (`RATE_LIMITED` in `stage1` and `matrix`, run back to back); each re-run alone: `stage1` 8/8, `matrix` 19/19. Remaining files passed in the full run | OBSERVED |
| Flutter `flutter analyze` | no issues | OBSERVED |
| Flutter `flutter test` (proxy variables unset, `NO_PROXY=localhost,127.0.0.1`) | 37 pass (32 before plus 5 identity tests) | OBSERVED |
| Web and console Playwright | not run: the running :4000/:4200 services serve the previous build and the brand session owns their restart; the new pages are typechecked only | BLOCKED |
| Flutter web build and smoke test | not rebuilt (the serving of :4300 is shared); new screens covered by analyze and unit tests only | BLOCKED |

## Limits and open items
- New dependency: Flutter `image_picker ^1.2.3` (file/photo chooser on Android, iOS and web; no existing dependency can pick a file). Resolved offline from the pub cache. No new server dependency: the metadata stripper is in-repo (ADR-0005 V7).
- Rebuild needed: web (`pnpm --filter @unitravel/web build`) and console (`pnpm --filter @unitravel/console build`) then `scripts/svc.sh restart web console`; Flutter web `flutter build web --release --no-web-resources-cdn`. API and worker were rebuilt and restarted. After applying migration 0004 clear `perm:*` in Valkey (runbook `identity-verification.md`); done locally.
- The notification matrix is stored as config version 1; the three new rules exist in the defaults for new installs. Existing databases fall back to inbox-only (non-critical) until the matrix is republished in the Developer Panel. Templates were inserted by the seed.
- Orientation of a scan is the customer's (the EXIF orientation tag is removed with the rest of the metadata).
- `cargo_admin` can still open scans through its table 10.1 grant of `customer.read.documents` (audited); flagged in the DPIA.
- A PDF is not accepted as a passport scan.
- The Playwright flows for the new screens are not written yet (BLOCKED above); the console and web pages follow existing component patterns.

## Post-phase verification (23 Oct 2026, orchestrating session)
| Check | Result | Label |
|---|---|---|
| Browser upload to storage (`apps/web/e2e/identity.spec.ts`, new) | Failed before the fix for **every** document type, not just passport scans: the web CSP `connect-src 'self'` blocked the pre-signed PUT, and the buckets had no CORS rules. Pre-existing since Stage 2 (earlier uploads were only tested from Node). Fixed: `apps/web/src/proxy.ts` adds the storage origin to `connect-src`; `apps/api/src/core/storage.ts` sets bucket CORS (PUT from web, mobile-web, admin origins; `content-type` and `x-amz-server-side-encryption` headers). Passes. | OBSERVED |
| SSE master key | Was committed as a default in `infra/compose.dev.yml` (rule 6). Moved to the git-ignored `.env` (`RUSTFS_SSE_S3_MASTER_KEY`, same local value so existing encrypted objects stay readable); `.env.example` and `docs/LOCAL-DEV.md` updated; compose now fails fast if it is unset. | OBSERVED |
| Web Playwright (rebuilt web) | 27/27 incl. axe, desktop + mobile. `e2e/helpers.ts` `signIn` now completes the first-sign-in name step. | OBSERVED |
| Console Playwright (rebuilt console) | 11/11. The new verification screens have no Playwright flow yet. | OBSERVED |
| Flutter web smoke | Not run (needs `flutter build web --release --no-web-resources-cdn`). | BLOCKED |

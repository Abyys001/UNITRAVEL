# UniTravel build plan and progress

Source of truth for scope: `UniTravel-Implementation-Booklet-v1.0-DRAFT.pdf` (text copy: `docs/booklet.txt`).
Owner instruction (22 Oct 2026): build the whole platform in one session, verify after every stage, Flutter
(kit stack) for mobile tested through the Flutter web build, assets via Canva, finish with a narrated teaser video.
Booklet rule 35.1/9 ("stop at each gate") is superseded by that instruction; each stage gate is instead a
recorded verification in `docs/stages/STAGE-N.md`.

## Stack (engineering kit + approved additions, see docs/adr)
- pnpm workspaces + Turborepo · TypeScript everywhere except mobile
- apps/api — NestJS 12, two roles (`main.api.ts`, `main.worker.ts`), Drizzle + PostgreSQL 18, Valkey (Redis) + BullMQ
- apps/web — Next.js 16 customer site `/en` `/fa` (RTL) · apps/console — Next.js 16, admin.* and dev.* hosts
- apps/mobile — Flutter (kit `flutter-app` + `kit_ui`), customer + admin modes (ADR-0002 replaces Expo)
- packages: contracts (Zod, permissions, errors), domain (state machines, formats), engine (itinerary engine),
  db (Drizzle schema/migrations/seed), i18n (en/fa), ui (React components)

## Local ports
api 4100 · web 4000 · console 4200 (admin.localhost / dev.localhost) · flutter web 4300
postgres 5462 · valkey 6390 · rustfs 9010 · mailpit smtp 1035 / ui 8035

## Stages (booklet ch. 31) — status
- [ ] Stage 0 — discovery/legal: documented as BLOCKED/UNKNOWN items (docs/stages/STAGE-0.md)
- [x] Stage 1 — foundations: monorepo, CI, compose, identity (OTP phone/email, sessions, refresh rotation, devices,
      staff TOTP/passkey, step-up), access (roles, perms, perm_version), audit, config (settings, flags, versions),
      reference data, notifications core (inbox, SMS router, templates), Dev Panel §1 §7 §8 §9 §10
- [x] Stage 2 — customers/travellers (encrypted docs), requests state machine, quotes, bookings, payments (ATOL),
      compliance (lists, matcher, cases, policies), SLA timers, Admin Panel, web request tracking  (M1)
- [x] Stage 3 — supplier framework (fake, Duffel, Amadeus-flagged, manual), engine, search jobs + SSE,
      itinerary detail, snapshots, revalidation, staff search, rule editor + simulation, seat maps
- [x] Stage 4 — Flutter app (customer + admin mode), push registration, deep links, web build test
- [x] Stage 5 — cargo (lanes, partners, availability register, goods screening, AWB, tracking)
- [x] Stage 6 — hardening: security headers/CSP, permission-matrix test, property tests, k6, a11y, runbooks, DPIA draft
- [x] Assets (Canva) · teaser video with voiceover (media/teaser/uni-travel-teaser.mp4)

## Additional requirements (23 Oct 2026) — status
Spec and owner decisions: `docs/ADDITIONAL-REQUIREMENTS.md`. Sequential; each ends with a STAGE record.
- [x] Phase A — price confidentiality (STAGE-7)
- [x] Phase B — identity, profile, passport, verification (STAGE-8)
- [x] Phase E — cargo tracking improvements (STAGE-9)
- [x] Phase C — quotations and invoices (STAGE-10)
- [x] Phase D — Stripe Embedded Checkout, test mode only; live BLOCKED (STAGE-11)
- [x] Phase F — design and UX (STAGE-12)

## Content, menu and live data (27 Oct 2026) — status
Spec and owner decisions: `docs/CONTENT-MENU-LIVE-DATA.md`.
- [x] Phase G — live data only on deployed hosts (STAGE-14)
- [x] Phase H — FAQ, travel rules, flight-buying guide (STAGE-15)
- [x] Phase I — menu, service requests, tracking, support, customer club, vertical ports (STAGE-16; visual re-baseline and Flutter analyze still to run, see the record)

## Security hardening and operability (28 Oct 2026) — status
Owner request: "make it really good locking and secure backend and also ready to use". ADR-0017.
- [x] Stage 17 — security review fixes, deployment hardening, one-command local set-up, first-owner bootstrap (STAGE-17)

## Progress log
(append one line per completed unit of work)
- 2026-10-22 contracts (Zod schemas, permissions, errors, defaults) · domain (state machines, formats, payments; 17 tests incl. properties) · engine (plan/filter/join/validate/score/diversify; worked example + 5 property tests green)
- 2026-10-22 db: full ch.23 schema + security migration (partitions, insert-only grants, triggers, roles) + seed (reference, roles, config v1, 190 templates, D-01 policy, lanes)
- 2026-10-22 api Stage 1 backend: identity (OTP+PoW, EdDSA JWT, refresh families, TOTP/WebAuthn, step-up), access (perm_version), audit (hash chain), config (versions), notifications (inbox/push/SMS/email, routing, escalation), suppliers (fake/duffel/amadeus-pending/manual + gateway), dev panel APIs. e2e stage1 8/8, route fail-closed 3/3. Start/stop: scripts/svc.sh
- 2026-10-22 Stage 2 backend: documents (presigned+scan), travellers (AES-GCM docs, audited reveal), compliance (UK 6408/OFAC 19471/EU 6234 live lists + fictional TEST list, matcher tuned after real false positive), requests (state machine, quotes, notes, messages, contacts, SLA timers), bookings/payments (ATOL PAY_ON_TICKETING, four-eyes verify, credit override, after-sales). e2e 12/12.
- 2026-10-22 Stage 3 backend: search jobs (waves, leg cache, budgets, capacity wait), SSE, itinerary/price-check/seat maps, SearchPort → ITINERARY requests with immutable snapshots, staff search, simulator. e2e stage3 9/9 (benchmarks THR/TBZ/MHD/EVN).
- 2026-10-22 Stage 5 backend: cargo (lanes w/ owner+compliance dual approval, partners+screening, availability register, goods screening, quotes, AWB, re-weigh exception, tracking, PDFs). Full e2e 25/25.
- 2026-10-22 web (Next 16.4.2, /en + /fa RTL): home, search+SSE results, itinerary+price check+seat map, request, tracking, cargo, account, inbox. Playwright 6/6 + axe 14/14.
- 2026-10-23 mobile (Flutter, subagent): customer + admin mode, offline cache, deep links; analyze clean, 30 tests, release web build, smoke 14/14 (apps/mobile/test-artifacts).
- 2026-10-23 Stage 6: permission matrix e2e, serialiser property test (customer views parsed via strict schemas), benchmarks made strict (FAKE network gaps fixed), price-check honoured at submit (tested), Dockerfile (api/migrate/web/console, smoke-tested), Caddy + prod compose, CI workflow, k6 (SLO met at 0.5 searches/s; capacity bound by provider limits), backup-restore drill. API e2e 44/44.
- 2026-10-23 console (Next, admin.localhost/dev.localhost): queue, request detail, quote builder (amount validation), compliance, cargo, Developer Panel, staff SSE. Playwright 11/11.
- 2026-10-23 gaps: SLA timers were never scheduled (BullMQ rejects `:` in job ids) → fixed + reconcile; route-health job; staff directory; admin SSE. Docs: runbooks, DPIA draft, STAGE-0/6, ADR-0003, reference data. API e2e 48/48.
- 2026-10-23 assets: Canva social image, title/end cards, app icon, promo (assets/brand/README.md); icons wired into web, iOS, Android, Flutter web. Persian separator fix (، instead of · next to Persian digits).
- 2026-10-23 teaser: Playwright-recorded scenes, Kokoro TTS voiceover, ffmpeg edit → 148 s 1080p30, −16 LUFS. Final regression: typecheck 0 errors; unit 22/7/8; API e2e 48/48; web 22/22; console 11/11; Flutter analyze clean, 30 tests.
- 2026-10-23 supplier-price leak fixed: customer quote options drop supplierPrice/supplierFetchedAt/supplierExpiresAt/components, customer snapshot drops priceAtSubmit/priceRevalidated; serialiser property test contaminates with them and covers a sent quote (fails on the old contract). API unit 9/9; e2e 48/48 (matrix re-run alone after an OTP rate-limit hit in the full run).
- 2026-10-23 brand + visual overhaul to the real unitravels.co.uk identity (owner request): DESIGN.md "Night flight"; tokens navy/royal/cyan/orange in packages/ui (legacy copper/sand names swept and removed); Montserrat + Vazirmatn self-hosted (kit fonts/montserrat added); SVG logo redraw (packages/ui/src/brand/logo.tsx, assets/brand/logo/); brand art (Ribbon, FlightPath, IconBadge, GlobeLines, Reveal); web home rebuilt (video hero, trust strip, path steps, destination bento, cargo band, app promo, navy footer), inner pages restyled (airline result cards, flight-path timeline, split sign-in, /credits); console and Flutter re-skinned; icons/OG regenerated; stock media in apps/web/public/media (CREDITS.md); inspiration in kit sources/references/travel-brand-2026. Web e2e 26/26 incl. axe, console 11/11, Flutter analyze clean + 30 tests + smoke 14/14.
- 2026-10-23 Phase A price confidentiality (ADR-0004): customer search/itinerary/seat-map/snapshot carry no amounts, neutral ranking, staff-only price check, pricing.read.internal/pricing.write/commercial_document.issue (admin, owner; migration 0003), web+Flutter+console updated. API unit 13, engine 7, domain 22; API e2e 49/49; Flutter analyze clean, 32 tests; web/console Playwright not run (web service down).
- 2026-10-23 Phase B identity verification (ADR-0005): verification state machine + property tests, passport scans (separate SSE bucket, EXIF stripped, JPEG/PNG), audited downloads (`customer.read.documents`) closing the unaudited-download hole, `identity.verify` (admin, owner; migration 0004), staff queue/compare view, record_tickets needs VERIFIED travellers, My details + add-and-verify on web/Flutter. Domain 33, engine 7, api unit 24, API e2e 53 (stage1/matrix re-run alone after OTP cooldown), Flutter analyze clean + 37 tests; web/console/Flutter-web Playwright not run (services are the brand session's).
- 2026-10-24 Phase E cargo tracking: `CargoTrackingPort` + manual adapter, append-only corrections (`correctsEventId`, audited), `externalEventId` dedupe, `estimatedDeliveryAt` (labelled estimate), en/fa event labels, customer Shipments overview/summary (web, Flutter), console correction + ETA (migration 0005, no new permission). Domain 39, engine 7, api unit 28, API e2e 56 (stage2 re-run alone after OTP cooldown), web 28/28, console 12/12 (1 re-run alone, OTP cooldown), Flutter analyze clean + 41 tests.
- 2026-10-24 Phase C quotations and invoices (ADR-0006): numbered quotations (PDF, email, short link, SMS fallback), invoice state machine (expiry = CANCELLED/EXPIRED, PAY_ON_TICKETING same-day Europe/London guard, amounts frozen by trigger), gap-free numbering, billing area (web, Flutter), console panel and list, expiry job, payment seam for Phase D (migration 0006, no new permission). Domain 50, engine 7, i18n 2, api unit 35; API e2e 61 (matrix, stage1, stage2 re-run alone after OTP cooldown); web 29/29; console 13/13 in one full run (OTP flake fixed: seeding reuses the page session); Flutter analyze clean + 47 tests.
- 2026-10-24 Phase D Stripe Embedded Checkout, test mode only (ADR-0007 amends D-03; live BLOCKED in code): payment port with Stripe and FAKE adapters, embedded_page sessions (amount from the invoice, one reusable session), signed webhook on the raw body with `stripe_events` dedupe, only verified events create CARD_ONLINE payments and settle invoices, reconciliation job, mismatch/dispute cases, refunds with four-eyes above the existing threshold, eligibility policy as compliance data, Developer Panel (write-only test keys, mode workflow, events, health), Admin Panel payment block, web pay and return pages with page-scoped CSP, Flutter opens the web pay page (migration 0007; 4 new permissions, clear Valkey `perm:*` after deploy). Domain 67, api unit 43, i18n 3; API e2e 72 (matrix re-run alone after fixing my own test); web 30 (shipments re-run alone after an OTP cooldown); console 14 + 1 mobile; Flutter analyze clean + 76 tests. Not run against real Stripe (no key): STAGE-11.md lists what is INFERRED.
- 2026-10-24 Phase F design and UX (audit and improve, no new direction): audit `docs/design/AUDIT-2026-10.md`; one token source (`packages/ui/tokens/tokens.json` -> CSS + Dart, stale check in `pnpm test`); shared patterns (timeline, stepper, document card, verification badge, payment state, loading/empty/error, NativeSelect, console ledger kit); console `ui.tsx` slimmed; 7 axe findings fixed; web 106 Playwright (76 visual+axe), console 87 (72 visual+axe), Flutter 24 goldens. Final regression in STAGE-12.
- 2026-10-25 console rebuild "Clear deck" (owner request): flat rail + hub tabs, list kit, all admin and developer pages rebuilt, no access reduced. tsc 0; console e2e 15/15; visual+axe 72/72 (re-baselined). Record: docs/stages/ui-clear-deck/README.md.
- 2026-10-25 Test sign-in and VPS readiness (owner request, ADR-0012): `TEST_SIGN_IN` env switch (default off, API refuses to start with it on in production); `GET/POST /v1/auth/test-sign-in` signs in with an email only (staff skip the second factor, audited `user.test_signed_in`); "Test sign-in (testing phase)" box with email autofill on web, Admin and Developer Panels (`packages/ui` `TestSignIn`) and Flutter. `infra/compose.prod.yml` now ships storage (RustFS + `STORAGE_HOST`), seed, mobile web (`MOBILE_HOST`), optional mailpit, and passes the public URLs the web CSP and console host split need; demo-user seed works outside local (demo TOTP secret stays local only); runbook `docs/runbooks/deploy-vps.md`. Staging stack built and smoke-tested locally (all hosts 200, browser test sign-in on web, admin and dev). api unit 61, API e2e 103 (1 failure: platform SLA-timer reconcile, see open issue), web 107/107 (+1 skipped), console e2e and Flutter 106 tests / analyze clean; stale sign-in snapshots and goldens re-baselined. Open: `timers.sla` keeps only 2000 completed jobs, so reconcile re-adds and re-fires older timers (INFERRED duplicate escalations); domain name-matcher property test fails on some seeds (Shirazi/Sharifi over the review threshold, the safe direction; compliance policy, not changed).
- 2026-10-27 ADR-0013 (owner brief: Stripe/booking/invoice/email audit, then fix traveller PATCH, payment emails, discounts and extras, staff amendments): migration 0009, 5 notification events with en/fa templates, amend endpoint with compliance re-screening, extras/discount lines in quotes, invoices and PDF, console amend dialog and builder rows, web breakdown. Domain 88/89 (known name-matcher), api unit 60, stage13 e2e 5/5; full e2e run stopped by host memory before dashboard/platform/stage11; console Playwright not run. Record: docs/stages/STAGE-13.md.
- 2026-10-27 console request page: Customer, Travellers and Request panels redesigned (components/flight/request-panels.tsx: contact card with actions, traveller cards with pill badges, per-flight trip rows with place names from the new staff-detail `places` map, preference chips, customer's brief, customer note). tsc 0; deployed to staging (api, console); checked by screenshot only, console Playwright not run.
- 2026-10-28 Phase I completed (STAGE-16): customer club backend (migration 0011, ADR-0016 ledger and four-eyes rules, real club-discount check on service quotes, `GET /v1/me/club` 200 with `enabled`), web menu from `/v1/site`, service request pages and detail, track, support, club pages, console service queue/detail and club pages, Flutter Account › Services. Checks in docs/stages/STAGE-16.md.
- 2026-10-28 Stage 17 security hardening (ADR-0017, STAGE-17): staff second factor can no longer be bypassed by enrolling a new factor; staff permissions gated on website and pre-MFA sessions; atomic OTP/tracking attempts and single-use codes; OTP lockout-by-others closed; request-scoped document and quote ids; cumulative four-eyes; signed upload size + magic bytes; append-only tables refuse DELETE/TRUNCATE (migration 0012); log scrubbing; start-up preflight (secrets, DB role); prod compose (TRUST_PROXY, Valkey password, no-new-privileges, db-maintenance backups/partitions), Caddy edge fixes; sign out other devices; Developer Panel second-factor reset; `scripts/setup-local.sh`; `create-owner`. API unit 85/85; security e2e 11/11; every API e2e file green on its own (see record); web Playwright 10/10 for the touched specs.

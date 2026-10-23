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

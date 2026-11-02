# Verification report: flights → request → services → invoice → payment (STAGE-23)

Date: 2 Nov 2026. Branch `feat/flights-requests-invoices`. Plan: `docs/build/MASTER_PLAN.md`. Stream reports: `STREAM_B_REPORT.md`, `STREAM_C_REPORT.md`, `STREAM_D_REPORT.md`. Stream A is STAGE-22 (session `apify-google-flights-source`, commits `bb34763`, `f6d14b0`).

Everything below ran on an **isolated stack** built from this branch: Postgres on 127.0.0.1:5499 and Valkey on 127.0.0.1:6499 (throwaway containers), API and worker on :4199, customer web on :4098, console on :4299. The shared dev stack (:4000/:4100/:4200/:5462/:6390) was not used, except Mailpit (:8035), a shared mail sink that tests search by recipient.

## Results

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Typecheck, unit tests | PASS | `pnpm -r typecheck`: 9/9 packages. Unit: api 210, domain 116, contracts 31, i18n 22, engine 13, db 8 (400 total). No `lint` script exists in any package (OBSERVED), so none was run. |
| 1b | API e2e (24 files + `identity-in-use`) | PASS per file | Each file passes run on its own. Run as one suite, OTP resend cooldowns and rate limits for the shared demo users fail later files with 429 (OBSERVED on a fresh DB). That is a property of the suite, not of this branch. |
| 1c | Migrations on a fresh DB | PASS | `0000`–`0021` applied with `migrate.js`, then the seed. Checked: tables, CHECKs `service_catalog_price_chk` and `reservations_ref_chk`, nullable `record_locator`, `app_rw` grants, `service_catalog.manage` on admin and owner, catalogue seed (5 items, inactive, price 0), `FLIGHT:IR:*` REVIEW (local seed). |
| 2 | Playwright flow: Stripe test mode | **BLOCKED** | `stage23-flow.spec.ts` › "stripe flow" is written: a direct SERVICE invoice is paid with test card 4242, and the webhook marks it PAID. It is guarded by `STRIPE_E2E` and has not run, because no Stripe test keys are entered yet. Stripe CLI 1.55.6 is installed. |
| 2b | Playwright flow: offline, default `PAY_ON_TICKETING` | PASS (2 runs) | "offline flow": search (no prices) → itinerary → sign-in → request with INSURANCE interest → console sees prices and re-check → quote with catalogue line, Send blocked while a manual option has UNKNOWNs → accept → reservation with external reference only → ticketing with payment in the same step → invoice issued, already PAID → receipt email with PDF and no "pay by" → both panels final. |
| 3 | Same flow with online payment off | PASS | 2b runs with `payments.online.enabled=false`. `stage23-payments.e2e.ts` covers the bank-transfer block in the issued email, mark-paid and the receipt (3 stable runs). |
| 4 | Compliance flow | PASS | "compliance flow": IKA→IST → COMPLIANCE_HOLD → release dialog shows the pending-counsel warning (ADR-0031 I6) → compliance officer releases with a reason → NEW. API: `services-catalog.e2e.ts` covers IR → hold and non-IR → NEW. |
| 5 | Price-leak audit | PASS | Contract helper `apps/api/src/testing/leak.ts` is used in `serialisers.spec.ts` and the catalogue e2e. Web crawl `price-leak.spec.ts` (logged out and signed in, en and fa) scans HTML, RSC payloads, JS chunks, API responses and console for forbidden keys and Google URLs: 0 hits. The flow spec runs the same scan on every customer page it visits. |
| 6 | Cost audit (Apify) | PASS (Stream A, uncommitted) | Stream A's specs, 58/58 reported by that session: 200 concurrent identical searches → 1 Apify POST and 1 `provider_runs` row (single-flight per cache key on the run; 200 start jobs with no network); cache hit → 0 calls; customer pool and staff reserve; hourly cap; `startRun` refuses input without `maxResults` and `maxTotalChargeUsd > 0`. INFERRED until that session commits. CI never calls Apify or Stripe: all tests use fixtures and mocks (OBSERVED in the specs). |
| 7 | Security | PASS with notes | New admin routes are fail-closed (`routes.spec.ts`) and in the permission matrix. Catalogue writes need `service_catalog.manage`, quote options need `pricing.write`. Webhook signature and idempotency are unchanged from STAGE-11 (`stripe_events`) and covered by Stream D's ordering tests. No secrets in tests, fixtures, logs or commits. The isolated env file is in the session scratchpad, mode 600, outside the repo. |
| 8 | Failure drills | PARTIAL | Covered: Apify 401/timeout/failed run/zero rows (Stream A specs); duplicate and out-of-order webhooks, failed payment (Stream D `payment-flow.spec.ts`); email provider down → retry (Stream D `email-retry.spec.ts`, unit level only). Not run: email outage at e2e level (it would mean breaking the shared SMTP config). |
| 9 | UX | PARTIAL | 45 screenshots in `docs/screens/stage23/` (customer en and fa at 390 and 1360 px; console mostly desktop). Not reviewed by eye yet. Accessible fieldset/legend on the interests list. No automated contrast audit was run for the new screens. |

## Fixes made during verification

| Commit | Fix |
|---|---|
| `4e4b9d4` | Catalogue extras reach invoice lines with type and quantity × unit (were quantity 1, no type). Six e2e fixtures move from THR to IST (ADR-0031 I4 now holds Iranian airports). Hand-written migration 0021: the Drizzle snapshot is stale since 0002, so `drizzle-kit generate` would re-create 28 tables. |
| `624fe0e` | Test fixes: matrix lists only swept routes; emails matched by subject; `phase-j` queue honours `REDIS_URL` (it hit the shared Valkey). |
| `9713104` | **Bug (pre-existing):** adding a phone or email that belongs to another account showed "The request is not valid". Now `IDENTITY_IN_USE` with an en/fa message. Regression test `identity-in-use.e2e.ts`. |
| `474a5db` | **Bug (pre-existing):** under `PAY_ON_TICKETING` the console never offered ticketing, because the action list required PAID before the step that records the payment. **Bug:** an invoice already paid when issued sent an "issued" email saying "Pay by" and "How to pay"; now only the receipt goes, with the PDF. |

## Remaining risks

- Stripe flow is unverified end to end (item 2).
- Stream A's last changes (cost-audit tests, `maxResults` guard, result-card `ComplianceReviewNote`) are not committed yet. Rebase this branch onto them before merging.
- The other session's uncommitted `/v1/destinations` and web i18n work touches `en.ts`/`fa.ts`. Stream B appended in one block at the end, so the merge should be trivial.
- Deployed hosts have no `FLIGHT:IR:*` row until staff create it (ADR-0031 I3a). Until then, Iran results show without the review note, but every such request is still held (I4).
- The catalogue is seeded inactive at price 0. Staff set real prices; nothing customer-facing appears until then.
- The console ticketing dialog is now offered under `PAY_ON_TICKETING` (`474a5db`), but the flow test posts the ticketing step by API. The dialog itself has not been driven in a browser yet.
- Whole-suite API e2e run is rate-limited (item 1b). Run per file, or reset cooldowns between files.
- The `0021` migration was applied to a throwaway DB only, not to the shared local DB.

## Open owner decisions

- STAGE-0 item 1: counsel on selling Iran-origin itineraries (ADR-0031 accepted the risk of showing them and taking requests).
- Stripe live mode stays BLOCKED (D-03).
- ATOL mode: `PAY_ON_TICKETING` kept (owner, 2 Nov 2026). Online card payment therefore applies to service invoices only. Flights are paid at ticketing.
- Email for Persian users: server `detail` texts are English where no code-to-message mapping exists (pre-existing).

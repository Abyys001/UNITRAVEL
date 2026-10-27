# Stage 14 record: Phase G, live data only on deployed hosts

Source: `docs/CONTENT-MENU-LIVE-DATA.md` §2 (owner, 27 Oct 2026: "no test and non-test: all data live, especially flights"), decision O11. ADR-0014 (amends ADR-0007 and ADR-0012).

## What changed (DOCUMENTED)
- `apps/api/src/core/env.ts`: `sandboxAllowed()` = `APP_ENV=local` and `NODE_ENV` not `production`. Every sandbox switch below uses it. `TEST_SIGN_IN` stays only so the API keeps refusing `on` in production.
- Flights (G1–G3): `FakeAdapter` refuses to construct outside local; `SuppliersService` registers it only locally; the Developer Panel refuses to change the `fake` row outside local; provider environment is `production` everywhere except local, so staging reads live credentials and never searches test-environment rows; a `duffel_test_` token is refused at entry and at call time for a live environment (prefix INFERRED from Duffel's token format, confirm in the Duffel dashboard).
- Seed (G4): `packages/db/src/seed/providers.ts` (`providerSeedRows`, `shouldSeedDemo`): outside local no `fake` row, Duffel and Amadeus seeded as `production` and disabled, no demo users. `infra/compose.prod.yml` defaults `SEED_DEMO=0`.
- Payments (G6): FAKE payment adapter and provider local only; `canEnterStripeMode(mode, deployed)` refuses test mode on deployed hosts; the Stripe credential writer accepts no keys on a deployed host (live stays BLOCKED by ADR-0007, so online payment is unavailable there and customers pay offline).
- Test sign-in (G7): removed, then **restored unchanged** the same day by owner decision (staging sends email to an internal sink, so testers could not sign in otherwise). It stays behind `TEST_SIGN_IN` (staging opt-in, refused in production); ADR-0012 status updated, ADR-0014 records the exception. `infra/compose.prod.yml` and `infra/.env.prod.example` default `SEED_DEMO=0`.
- Tests added (G8): `apps/api/src/modules/suppliers/live-data.spec.ts` (FAKE flight and payment adapters refuse staging and production and construct locally; `searchable()` never returns `fake` or test-environment rows on staging even with a pre-ADR database; Duffel refuses a test token for a live environment before any network call; the Developer Panel refuses a Duffel test token outside local), `packages/db/src/seed/providers.spec.ts` (staging/production seed: no fake row, live environment, providers disabled, no demo users), domain `online-payment.spec.ts` (test mode refused when deployed), `apps/web/e2e/live-data.spec.ts` (no live sources: notice and "Ask our team", no test-data tag, en and fa). The payments spec now checks the NODE_ENV net.

## Verification (OBSERVED, 27 Oct 2026, local stack)
| Check | Result |
|---|---|
| Typecheck | contracts, domain, db, ui, api, console: 0 errors. web: see the web row |
| Unit | api 65/65; db 4/4; domain 90/91 (the failure is the open name-matcher seed property, PLAN.md, unchanged) |
| API e2e, full | 91 tests: 87 passed. Failed: `matrix` owner/admin/compliance (the Phase I permissions were already in the catalogue, but their DB grants arrive with migration 0009; re-run in STAGE-16) and `platform` SLA-timer reconcile (open issue, PLAN.md 25 Oct) |
| Flutter | `flutter analyze` clean; `flutter test` 103 passed (shell proxy variables must be unset for `flutter_tester`) |
| Web e2e `live-data.spec.ts` | see "Web" below |

## On the VPS
- Done 27 Oct 2026 (OBSERVED): `UPDATE providers SET enabled = false WHERE id = 'fake'` on the staging database; a search on `demo.unitravels.co.uk` then completed with `NO_SOURCES`, 0 sources, 0 results. The code changes reach the VPS with the next deploy.

Still to do:
1. Keep `TEST_SIGN_IN=on` on staging until real email exists (owner); set `SEED_DEMO=0`.
2. One-off SQL with the migrate role (spec §2.3 G5): `UPDATE providers SET enabled = false WHERE id = 'fake'; UPDATE providers SET environment = 'production' WHERE id IN ('duffel', 'amadeus-enterprise');`
3. Demo accounts on staging stay while test sign-in is on; deactivate them in Developer Panel › Users when real sign-in arrives.
4. Live flights: Duffel live mode and written confirmation about customers in Iran (UNKNOWN, counsel), then the live token in Developer Panel › Providers › Duffel (step-up), "Test connection", enable (spec §2.4). Until then searches answer `NO_SOURCES` with "Ask our team".
5. Amadeus Enterprise stays BLOCKED (STAGE-0).

## Open
- Not observed against a real VPS or a real Duffel live token (none available): live results on staging are INFERRED from the code path and the unit tests.

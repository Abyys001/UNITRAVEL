# ADR-0014 · Live data only on deployed hosts

Status: accepted (owner instruction, 27 Oct 2026: "no test and non-test: all data live, especially flights"). Amends ADR-0012: test sign-in stays available on staging until real email exists (owner decision of 27 Oct 2026, see below). Amends ADR-0007 (Stripe test mode is now local only). Spec: `docs/CONTENT-MENU-LIVE-DATA.md` §2, decision O11.

## Context

Before this ADR every sandbox switch was keyed on "not production": a VPS running `APP_ENV=staging` registered the FAKE flight adapter (its seeded row enabled, so staging results contained FAKE offers labelled "TEST DATA"), read **test** provider credentials (a Duffel test token returns Duffel's sandbox content, not real flights), offered the FAKE payment simulator and Stripe test mode, seeded demo accounts and allowed the ADR-0012 email-only test sign-in. The owner wants a deployed host to show real data or nothing.

## Decision

- `APP_ENV=local` is the only place where FAKE adapters (flights and payments), sandbox provider credentials, Stripe test mode, demo users and test sign-in exist. `staging` and `production` behave the same for data: live providers only.
- One helper decides it: `sandboxAllowed()` in `apps/api/src/core/env.ts` is true only when `APP_ENV=local` and `NODE_ENV` is not `production` (the second condition keeps a production image with `APP_ENV` unset, which defaults to `local`, on live data).
- Flights: `FakeAdapter` refuses to construct unless `APP_ENV=local`; `SuppliersService` registers it only locally; the Developer Panel refuses to change the `fake` row outside local. Outside local the provider environment is always `production`, so only live credentials are read, and test-environment rows are never searched. A Duffel token starting `duffel_test_` is refused at entry (Developer Panel) and at call time when the environment is `production` (prefix INFERRED from Duffel's token format; confirm in the Duffel dashboard).
- Payments: the FAKE payment adapter and provider are local only; `canEnterStripeMode(mode, deployed)` refuses test mode on a deployed host, and the Stripe credential writer accepts no keys there. Live mode stays BLOCKED (ADR-0007 P1), so online payment is unavailable on every deployed host and customers pay offline, as today.
- Seed: outside local no `fake` row is inserted, Duffel and Amadeus rows are seeded with `environment = production` (disabled), and no demo users are created (`SEED_DEMO` only matters locally).
- Test sign-in (ADR-0012) is **kept for now** (owner decision, 27 Oct 2026, after this ADR was first written): the VPS sends email to an internal sink, so without it nobody could sign in there. It stays behind `TEST_SIGN_IN` (staging opt-in, refused in production) and is removed, or switched off, as soon as real email (SMTP) and SMS are configured. Demo users already on the staging database stay until then; no new ones are seeded outside local.
- With no live source enabled a search answers `NO_SOURCES` and the customer sees "Ask our team"; nothing fabricated is ever shown (rule 2).

## Consequences

- Staging can no longer exercise the Stripe or Duffel sandboxes; those are exercised locally and in CI, where `APP_ENV=local`.
- Live flights on a VPS need a live Duffel access token entered in the Developer Panel (and later the Amadeus contract, BLOCKED in STAGE-0). The steps are in `docs/runbooks/deploy-vps.md` and spec §2.4.
- A staging database seeded before this ADR needs the one-off SQL in spec §2.3 G5 (disable `fake`, move Duffel and Amadeus to `production`) and the demo accounts deactivated in Developer Panel › Users.
- Until real email exists, testers on staging keep using test sign-in; that host must hold test data only (ADR-0012).

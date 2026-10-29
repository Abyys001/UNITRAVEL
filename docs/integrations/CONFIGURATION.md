# Supplier adapter configuration and safe testing

Written 2026-10-29 from the code (apps/api/src/modules/suppliers, packages/db/src/seed/providers.ts, apps/api/src/core/env.ts). Provider credentials are never environment variables (env.ts header, booklet 36.3). They are entered in the Developer Panel (console `dev.` host, Providers page), stored encrypted with `MASTER_ENCRYPTION_KEY`, write-only and never displayed (CLAUDE.md rule 6). This file lists key names only, never values.

## How the pieces fit

- Rows: table `providers` (one row per adapter; fields enabled, environment, priority, capabilities, limits, markets, shadowMode). Seeded by `providerSeedRows()`. Outside `APP_ENV=local` rows are seeded `environment=production`, `enabled=false`, and no `fake` row exists.
- Credentials: table `provider_credentials`, unique per (provider, environment). The gateway reads only the environment that matches the host: `test` when `sandboxAllowed()` (APP_ENV=local and NODE_ENV not production), otherwise `production` (suppliers.service.ts `envName()`).
- Gateway protections per provider: absolute deadline, one retry for reads, requests/second and concurrency limits, circuit breaker (5 failures or 50% in 60 s), daily search budget, and a call record with redacted payload kept 14 days.
- API (all staff-only, Developer surface): `GET /v1/dev/providers`, `GET /v1/dev/providers/:id`, `PATCH /v1/dev/providers/:id` (permission `provider.config.write`; disabling needs a second-factor check within 10 minutes), `PUT /v1/dev/providers/:id/credentials` (step-up required, audited as `provider.credentials_rotated` with key names only), `POST /v1/dev/providers/:id/test` (`provider.config.read`).
- Env vars that matter to providers: `APP_ENV` (`local` | `staging` | `production`; defaults to `local`), `NODE_ENV`, `MASTER_ENCRYPTION_KEY` (required in production), `DATABASE_URL`, `REDIS_URL`. Nothing provider-specific is read from the environment.

## Per adapter

### duffel
- Keys (Developer Panel credential values): `accessToken` (required). Single bearer token.
- Environment: locally a `duffel_test_` token (sandbox, Duffel Airways ZZ plus some external airline sandboxes); on staging and production a live token only. A `duffel_test_` token is refused at entry (`setCredentials`) and again at call time when the environment is `production`. The prefix is DOCUMENTED in Duffel's test-mode page (ADR-0014 called it INFERRED).
- Capabilities in code: search (`POST /air/offer_requests`), price (`GET /air/offers/:id`), seat maps; order, cancel and ancillaries are false. Health check is `GET /air/airlines?limit=1`.
- Seeded limits: timeout 10 s, 6 concurrent, 5 rps, 3000 searches/day, look-to-book alert 1500 (matches Duffel's 1500:1 excess-search threshold). Point of sale GB, currency GBP.
- Baggage mapping: checked and carry-on read from segment passenger `baggages`; a missing field must remain UNKNOWN (rule 3).
- Safe test (local):
  1. Create a Duffel account, copy a **test** token.
  2. Developer Panel, Providers, Duffel, set `accessToken`, run Test connection (expects "GET /air/airlines").
  3. Enable the row. Search a route; Duffel Airways offers are unrealistic by design. Do not treat sandbox prices as market data.
  4. Leave `fake` enabled or disable it to isolate Duffel (priority order decides ranking).
- Go-live checklist (staging/production): written Duffel acceptance of the customer profile and Iran-connected itineraries (STAGE-0 A2, still BLOCKED); live token; row `environment=production`; start `enabled=false`, test connection, then enable with `shadowMode` first if you want to compare without showing results; confirm compliance policies are seeded; read docs/runbooks/supplier-outage.md.

### amadeus-enterprise
- Keys: none read by the adapter. A stored credential only changes the health message ("Credentials stored; adapter awaits the contract's WSDL mapping"). Expected shape once a contract exists is UNKNOWN (SOAP user/password/office ID or Enterprise REST client id/secret).
- Capabilities in code: all false; search and price throw `CONTENT_RESTRICTED`. Keep `enabled=false`. The seed row claims search/price true, but `searchable()` also requires the adapter's own capability, so the engine skips it.
- Safe test: Test connection returns `ok:false` with "Not configured: contract and sandbox pending". Nothing to configure until STAGE-0 A1 is resolved.
- Note: this adapter is for Amadeus Enterprise. The Self-Service API portal was reported shut down on 17 Jul 2026 (see PROVIDERS.md), so there is no Self-Service adapter and none should be added.

### manual
- Keys: none. Row is enabled, environment `production`, priority 0, no search. Search and price throw `CONTENT_RESTRICTED` by design. Staff enter options in the console quote builder. Health is always ok.
- Safe test: Test connection returns "Staff-entered options". No external calls.

### fake
- Keys: none. Exists only with `APP_ENV=local` and `NODE_ENV` not production; `PATCH /v1/dev/providers/fake` and construction refuse otherwise. Deterministic offers from fake-network.ts, labelled fake, for tests and benchmarks (THR, TBZ, MHD, EVN).
- Safe test: default local stack (`scripts/svc.sh`, docs/LOCAL-DEV.md). Never enable on a deployed host.

## Related adapters (for reference, same Developer Panel)

| Area | Where | Key names (values never recorded) | Notes |
|---|---|---|---|
| SMS Kavenegar | vendor-schemas.ts `sms:kavenegar` | `apiKey`, `sender?` | `+98` numbers only; failover to SMS.ir |
| SMS SMS.ir | `sms:smsir` | `apiKey`, `lineNumber` | `+98` only |
| SMS Sinch | `sms:sinch` | `servicePlanId`, `apiToken`, `sender`, `region?` | international |
| SMS Infobip | `sms:infobip` | `baseUrl`, `apiKey`, `sender`, `webhookSecret?` | delivery webhook secret in the query string; consider moving to a header |
| Push | `push:expo`, `push:pushy` | `accessToken`; `secretApiKey` | Pushy is behind flag `push.pushy_pilot.enabled` |
| Email | env `SMTP_URL`, `MAIL_FROM`; vendor `email:brevo` | `smtpUser`, `smtpKey` | local Mailpit on port 1035; staging mail sink profile (docs/runbooks/deploy-vps.md) |
| Stripe | Developer Panel payments | `secretKey`, `publishableKey`, `webhookSecret` | test mode, local only (ADR-0007, ADR-0014); live is refused in code |

## Safe-testing rules

1. Test credentials only on `APP_ENV=local`. Deployed hosts are live-only by ADR-0014; do not point real customers at a stack with `TEST_SIGN_IN=on`.
2. Use Test connection first; it makes one harmless read and records latency and error code.
3. Watch the call log (`provider_calls`) and Developer Panel health; a tripped circuit shows as OPEN and recovers by half-open probe after 30 s.
4. Keep `dailyBudget` and `rps` at or below the provider's contract; Duffel adds a fee beyond a 1500:1 search-to-book ratio.
5. Never paste a credential into chat, logs, tickets, fixtures or screenshots. Rotate through the Panel (step-up, audited).
6. Sanctions and carrier restrictions stay data in `compliance_policies`; enabling a provider does not change them.

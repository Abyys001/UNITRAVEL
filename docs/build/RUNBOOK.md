# Runbook: flights → request → services → invoice → payment (STAGE-26)

For the owner's review. General local setup: `docs/LOCAL-DEV.md`. Stripe incidents: `docs/runbooks/stripe-webhook-failure.md`.

## 1. Run it locally

```sh
cp .env.example .env                                   # once
docker compose --env-file .env -f infra/compose.dev.yml up -d
pnpm install && pnpm -r --filter "./packages/*" build
cd packages/db && pnpm migrate && pnpm seed && cd -   # applies 0024 (service catalogue, external booking reference)
cd apps/api && npx tsc -p tsconfig.build.json && cd -
scripts/svc.sh restart api worker web console
```

The shared local DB is used by other sessions. Tell them before applying `0024` and restarting (see `docs/runbooks`).

Customer site: http://localhost:4000. Admin: http://admin.localhost:4200. Developer Panel: http://dev.localhost:4200. Mail: http://localhost:8035.

## 2. Keys are entered in the Developer Panel, never in `.env`

Developer Panel (http://dev.localhost:4200), signed in as the developer or owner:

- **Apify**: Providers › `apify-google-flights` › Credentials: paste the Apify API token. It is write-only. The panel shows only that a key is set, never the key. The provider stays **disabled** until you enable it.
- **Stripe**: Payments › Stripe: test secret key (`sk_test_…`) and webhook signing secret (`whsec_…`). Live keys stay BLOCKED (D-03).

## 3. Apify $5 cap

- On Apify itself: Console › Settings › Usage & billing › set the monthly usage limit to **$5**. This is the hard stop.
- In the app: Providers › `apify-google-flights` › Metering. `monthlyBudgetUsd: 5`, pools `customer .4 / prewarm .3 / staff .3`, `staffReserveUsd .75`, `customerRunsPerHour 6`, `maxResultsCustomer 15`, `maxResultsStaff 30`, `cacheTtlSeconds 10800`. Every run sends `maxResults` and `maxTotalChargeUsd`, and the client refuses a run without them.
- When the customer pool is used up, customers see cached results or "Ask our team". The staff reserve is never spent by customers.

## 4. The one live Apify smoke test (only when you say)

Owned by STAGE-22 (session `apify-google-flights-source`). It is one run at `maxTotalChargeUsd 0.02`, never in CI. Ask that session (or me) to run it once you have entered the token. Expected cost: under $0.02. Check the run under Apify Console › Runs and in `provider_runs`.

## 5. Stripe: test → live

1. Test mode (local): run `stripe login`, then `stripe listen --forward-to localhost:4100/v1/webhooks/stripe`. Put the printed `whsec_…` into the Developer Panel. Turn on `payments.online.enabled` (owner approval). Pay a service invoice with `4242 4242 4242 4242`. The invoice turns PAID when the webhook arrives.
2. Live (BLOCKED until counsel answers D-03): add a live endpoint in the Stripe Dashboard → `https://<api-host>/v1/webhooks/stripe`, with the events listed in `stripe-webhook-failure.md`. Enter the live keys in the Developer Panel. The mode change needs owner approval in the panel.
3. Under `PAY_ON_TICKETING` (current ATOL mode), flights are paid at ticketing. Card payment applies to service invoices (visa, insurance, CIP, transfers…).

## 6. Before customers see the catalogue

Admin › Services › Catalogue: set real prices and descriptions (en and fa), choose whether the price is shown to customers, then activate. Seeded items are inactive at price 0.

On deployed hosts, Compliance › Policies: create the lane `FLIGHT:IR:*` = REVIEW (ADR-0031 I3a) so Iran results carry the review note. Requests touching Iran are held either way.

## 7. Demo script (click by click)

Demo users (local only): owner +447700900001, admin +447700900002, compliance +447700900004, developer +447700900005. Codes are in the dev SMS sink: http://localhost:4100/v1/dev-sink/sms.

1. Admin › Services › Catalogue: activate **Travel insurance**, price £25, "show price" off.
2. Customer site (logged out): search **Van (VAN) → Istanbul (IST)**, any date in December. Note: no prices anywhere.
3. Open a result › **Request this trip** › sign in with an email address. Add and verify a phone, add a traveller, tick **Travel insurance** under "Also interested in", send.
4. Admin › Requests: open the new request. You see prices, the customer's interest and **Re-check price**. Claim it.
5. **New quote** › from the snapshot › **Attach services** › Travel insurance (price can be overridden) › preview › send. Try adding a manual option with unknown baggage: **Send** stays disabled until it is fixed or removed.
6. Customer: My requests › the request › accept the quote.
7. Admin: **Record reservation** with only an external panel reference (no PNR) and a note.
8. Admin: mark the traveller verified (Identity), then **Record tickets**. The dialog records the customer's payment in the same step (bank transfer).
9. Admin: **Invoice** › draft from the quote › issue. It is PAID at once. The customer gets a receipt with the PDF (Mailpit), not a "pay by" email.
10. Customer: Billing › the invoice shows the airfare and **Travel insurance** lines, total, PAID, PDF.
11. Compliance: as a customer, request **Tehran (IKA) → Istanbul (IST)**. It lands in Admin › Compliance as a hold. Open it as the compliance officer, choose Release: the counsel warning shows. Give a reason, and the request moves to New.
12. Online card payment (after Stripe test keys): Admin › Invoices › **New direct invoice** for a customer with an insurance line › issue. The customer opens it and pays with 4242…. The webhook marks it PAID.

## 8. Tests

- Unit: `pnpm -r test` (no network).
- API e2e: `cd apps/api && pnpm test:e2e`, per file if the whole run hits OTP cooldowns (`npx vitest run --project e2e test/<file>.e2e.ts`).
- Browser: `cd apps/web && npx playwright test e2e/stage23-flow.spec.ts e2e/stage23-a11y.spec.ts e2e/price-leak.spec.ts --project=desktop`. Point it elsewhere with `WEB_URL`, `API_URL`, `CONSOLE_ADMIN_URL`, `CONSOLE_DEV_URL`, `MAILPIT_URL`, `DATABASE_MIGRATE_URL`, `REDIS_URL`. The Stripe test runs only with `STRIPE_E2E=1`, test keys entered, and `stripe listen` running.
- Email outage drill (never against the shared stack; it restarts the worker it is given): `DRILL_ENV_FILE=<env file> DRILL_RUN_DIR=<dir with worker.pid> API_URL=… DATABASE_MIGRATE_URL=… REDIS_URL=… MAILPIT_URL=… pnpm --filter @unitravel/api drill:email`. It skips itself without those variables.

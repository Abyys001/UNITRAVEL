# Stream D report: offline instructions, failed payments, daily Stripe drift report

Branch `stream-d` from `08eed8a`. Scope: ADR-0028 Checkout kept (no Stripe Invoices); flag `payments.online.enabled` (default false); live mode stays BLOCKED; email on the existing outbox, router and DB templates.

## Changes (file:line at commit)
- `apps/api/src/modules/invoices/invoices.service.ts`: `paymentInstructionBlocks()` (before "transitions"), and `issue()` adds `paymentInstructions: {en, fa}` to the `invoice.issued` outbox payload. Block is empty while `payments.online.enabled` is on; otherwise the configured text, or "contact us" wording when none is set (UNKNOWN stays UNKNOWN).
- `apps/api/src/modules/notifications/notification-router.ts` (~53-60): passes `payment_instructions_en` / `_fa` vars (the existing `_en`/`_fa` convention picks the recipient's language).
- `packages/db/src/seed/templates.ts`: `invoice.issued` email en/fa gain `{payment_instructions}`; var declared.
- `packages/db/src/seed/template-upgrades.ts` (new) + one line in `seed/index.ts`: seeding never overwrites templates, so an existing DB row is upgraded only while it still equals the previous default (edited templates are left alone).
- `packages/contracts/src/config.ts:225`: length limit (max 1500 per language) on `payment.offlineInstructions`.
- `apps/api/src/modules/payments/payment-drift.ts` (new): `compareSession` rules and report types.
- `apps/api/src/modules/payments/payments.service.ts`: `driftSweep()`, job `payments.drift` registered in `onModuleInit` next to `payments.reconcile`.

## Config
- DECISION NEEDED / deviation: the brief asked for a new key `payments.offlineInstructions`. OBSERVED: ADR-0020 already ships `settings.payment.offlineInstructions` ({en, fa} | null, null by default, editable in the console settings page and shown on the payment page). I reused it instead of creating a second source of truth; only added the length limit. No new key, no schema or migration.

## Events and templates
- `invoice.issued` (email en/fa): updated as above. INBOX/PUSH/SMS unchanged (no amounts, no instructions).
- `payment.failed`: OBSERVED already complete (event, router mapping, outbox route, en/fa INBOX/PUSH/SMS/EMAIL templates, matrix row, e2e in `stage13.e2e.ts`). Nothing added.
- Webhook behaviour verified, not changed (OBSERVED in `payments.service.ts`): `async_payment_failed` closes the OPEN session (FAILED), invoice stays ISSUED, one `payment.failed` outbox event only when the invoice is still ISSUED; `checkout.session.expired` closes quietly without a customer message (ADR-0013 A8, abandoned sessions are not announced). Replays are stopped by `stripe_events` (PROCESSED duplicate returns no row). Fail/expire after COMPLETE is rejected by the session machine (`fail`/`expire` only from OPEN), so a PAID invoice never moves back. A late paid event after EXPIRED/FAILED still settles (money is real).

## Job
- `payments.drift` on queue `maintenance`, BullMQ job scheduler `payments-drift-daily`, cron `30 3 * * *` (UTC). Up to 500 sessions per run, sequential provider reads.
- Compares sessions of ISSUED invoices (provider = active adapter) via `retrieveSession`. Findings: `MISSING_AT_PROVIDER`, `PAID_AT_PROVIDER` (missed webhook), `AMOUNT_MISMATCH` (amount or currency), `OPEN_EXPIRED_AT_PROVIDER`, `CLOSED_OPEN_AT_PROVIDER`.
- Report: one audit entry `payment.drift_report` (entityType `payment_drift`, entityId = date) with provider, checked, errors and findings (invoice number, session id, kind). No state change, no outbox event, no refund. Skips (no audit entry) when the flag is off or no adapter (no credentials, live mode, FAKE outside local). Provider errors are counted and logged by error class only.
- INFERRED: `PARTIALLY_PAID` does not exist in this repo (statuses are DRAFT, ISSUED, PAID, CANCELLED, REFUNDED), so only ISSUED is swept.
- Follow-up for the console (not in my ownership): none of the audit entries are surfaced in a dedicated screen; ops read them in the audit log.

## Offline path
OBSERVED: issue → email → staff `POST /v1/admin/invoices/:id/payments` (four-eyes threshold unchanged) → `settleFromPayments` → `markPaid` → `invoice.paid` outbox event → receipt email. No gap found; no change.

## Routes
None added or changed (no openapi.json, route-table or matrix rows needed).

## Tests
- `apps/api/src/modules/payments/payment-flow.spec.ts`: 11 tests (drift rules, sweep with mocked adapter: flag off, no credentials, match, mismatch plus error counting and no state change, webhook fail/expire ordering, no notice for paid-otherwise or abandoned, replay no-op).
- `apps/api/src/modules/invoices/invoice-email.spec.ts`: 5 tests (placeholder, instructions en/fa, unconfigured wording, online-on block empty, `findForbiddenKeys` clean and no secret patterns).
- `apps/api/src/modules/notifications/email-retry.spec.ts`: 2 tests (provider down: delivery FAILED and rethrown; retry sends; queue config 5 attempts with exponential backoff).
- API unit total: 27 files, 202 passed, 1 skipped (was 184 passed before this stream). `packages/db` 8 passed, `packages/contracts` 24 passed. `pnpm -r typecheck` green.
- `apps/api/test/stage23-payments.e2e.ts` (new): offline flow with email capture and receipt, length validation, online-on email, failed payment with replay, duplicate/out-of-order webhooks. NOT RUN: `test/global-setup.ts` connects to the shared dev Postgres (localhost:5462) and Valkey, not an isolated test database, so per the brief I did not run any e2e. The file is not covered by tsc (api tsconfig includes `src` and `test/fixtures` only). UNKNOWN until run: the 400 on an over-long instruction text and Mailpit subject matching.
- Email provider down at e2e level: not done (would require breaking the shared SMTP credentials); covered by the unit test above.

## Open items
1. Owner: confirm reuse of `payment.offlineInstructions` instead of a new `payments.offlineInstructions` key.
2. The email block depends on the flag only (InvoicesService cannot depend on PaymentsService without a cycle). With the flag on but a customer failing eligibility (policy, limit), the email omits the bank block and the payment page still shows the instructions.
3. Existing `direct-invoices.e2e.ts` now also sees the "contact us"/instructions block in the issued email when the flag is off; its assertions (no unresolved `{var}`) remain valid.
4. Run `stage23-payments.e2e.ts` on a throwaway stack before merge; re-seed or run the seed so existing DBs get the upgraded `invoice.issued` email template.

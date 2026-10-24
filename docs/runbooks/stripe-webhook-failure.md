# Runbook: Stripe webhook failure

ADR-0007 (Phase D, test mode only). Trigger: Developer Panel › Online payments shows failed events, a customer says they paid but the invoice is still unpaid, `GET /v1/dev/payments` reports `failedEvents > 0`, or webhook deliveries fail in the Stripe Dashboard. Live mode is BLOCKED; everything here concerns test mode and the FAKE adapter.

## What protects you
- The invoice moves to PAID only from a **verified** event (or the reconciliation job reading the provider). The customer's return redirect is never proof, so a missed webhook means "unpaid until reconciled", never "wrongly paid".
- `stripe_events` is unique by Stripe event id: a retry or a duplicate is safe. A FAILED event is re-run when Stripe retries it.
- Reconciliation (`payments.reconcile`, every 10 minutes, plus one delayed job per session shortly after its expiry, job ids `ps-<sessionId>--payment.reconcile`) asks the provider about OPEN sessions older than 30 minutes and settles them with the same code as the webhook. It runs even when the feature flag is off.

## Triage (15 minutes)
1. Developer Panel › Online payments: provider, mode, which keys are set, recent events, failed count, open sessions. `POST /v1/dev/payments/health-check` for the provider.
2. Why did deliveries fail? Look at the event outcome and its `error` text (no payload and no secrets are stored):
   - Stripe shows **400 from our endpoint**: the signature did not verify. Causes: the webhook signing secret in the Developer Panel is not the one of the endpoint in the Stripe Dashboard (test mode vs another endpoint), a proxy changed the body (the API verifies the raw bytes; nothing between Stripe and the API may re-serialise JSON), or the clock is more than 5 minutes off. Fix: copy the endpoint's signing secret from the Stripe Dashboard (test mode) into the Developer Panel (write-only, step-up). Webhook URL to register: shown on the page (`<PUBLIC_API_URL>/v1/webhooks/stripe`).
   - Stripe shows **5xx**: processing failed and rolled back. The event row says FAILED with the error. Fix the cause (database, a missing invoice, an ATOL or compliance error), then resend the event from the Stripe Dashboard; it is processed once.
   - **No deliveries at all**: the endpoint is not registered for the mode in use, the API is unreachable from the internet (local development needs `stripe listen --forward-to <api>/v1/webhooks/stripe`, which prints its own signing secret), or the endpoint is disabled by Stripe after repeated failures.
3. Is a customer's money taken but the invoice unpaid? Find the session in the invoice's Payment panel. Wait for the reconciliation job (up to 10 minutes) or run it: add a `payments.reconcile` job to the `maintenance` queue. If the provider says paid, the payment record appears (CARD_ONLINE, system-recorded) and the invoice becomes PAID.
4. Amount or currency mismatch, or a payment for an invoice that was cancelled meanwhile: the session is MISMATCH and a compliance case (evidence kind PAYMENT_MISMATCH) is open. Decide there; the usual outcome is a refund (see refunds.md). Nothing is recorded as settling the invoice.

## Switching provider or keys
- Rotating the Stripe keys needs step-up and the `payments.configure` permission; the audit log records the key **names** only. After rotation the in-process provider cache refreshes within 10 seconds.
- FAKE is for local and test only; the API refuses to select it in production.

## Escalate
Repeated signature failures from unknown sources are a possible probing attempt: the endpoint answers 400 with no detail and stores nothing. Treat a sustained spike like the OTP abuse runbook and consider an IP allowlist at the edge (Stripe publishes its webhook source addresses).

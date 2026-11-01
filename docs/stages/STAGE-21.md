# Stage 21 record: direct invoices and Stripe setup (1 Nov 2026)

Source: owner brief, ADR-0028. Not part of the booklet.

## What changed (DOCUMENTED)
- Admin Panel: New invoice on the invoice list and the customer page; customer search, service lines, discount, due date, note, save draft, issue and send. New invoice page with PDF, history, issue, edit draft, cancel, resend link, record and verify offline payment, refunds, online-payment readiness.
- API: `POST /v1/admin/invoices`, `PUT /v1/admin/invoices/:id`, `POST /v1/admin/invoices/:id/payments`; new permission `invoice.direct` (owner, admin); migration 0019. Clear Valkey `perm:*` after deploy.
- Email: `invoice.issued` and `payment.requested` carry the services, total, due date and PDF, for all invoices. SMS, push and inbox stay free of amounts.
- Portal: service labels and the note on the invoice page; the existing pay and return pages take direct invoices.
- Developer Panel `/payments`: setup checklist, events to subscribe to, optional connected account id. Stripe calls and the pay page use the account; webhook events from any other account are refused.
- PDF: Persian typed into an otherwise English document now prints; before, it was silently dropped. The rule under the table header no longer strikes through the first row.
- Fixes found on the way: the service request page had no invoice panel; the invoice list linked service invoices to the wrong page; no route recorded offline payment on a SERVICE invoice, and second-person verification never settled one; `OnlinePaymentPolicyKey` refused `product:SERVICE`.
- OpenAPI regenerated.

## Verified (OBSERVED, local stack, FAKE provider)
- API e2e: `direct-invoices` 9/9, stage10, stage11, stage13 19/19, matrix 23/23, services 9/9 (run with `loyalty.enabled` on, then restored off; it fails with the flag off, unrelated to this stage).
- Assertions that encoded the old rule were changed on purpose: stage10 and stage13 (amounts in the email), stage11 (`connectedAccountId` in the checkout response).
- Unit: API 112/112; contracts 17/17. Domain: the known `name-matcher` property fails, as recorded for ADR-0013.
- Playwright, real browser: console `direct-invoice` 3/3, web `direct-invoice` 1/1, web billing and payment 2/2.

## Not verified
- UNKNOWN: real Stripe and Connect calls. No test account exists yet; a unit test covers what is sent to the SDK.
- Not run: the full API e2e and Playwright suites, and visual baselines (billing and invoice screens changed, so `visual.spec` needs re-baselining).
- Not deployed.

## Owner actions before customers can pay online
1. Developer Panel, Payments: save test keys and the webhook secret; optional connected account id.
2. Compliance officer adds `ONLINE_PAYMENT` ALLOW `product:SERVICE`; owner approves.
3. Owner turns on `payments.online.enabled`.
4. Set the offline instructions in settings: until then a customer not offered Pay sees no instructions.
Live mode stays BLOCKED (ADR-0007).

## Open
- INFERRED: `APP_ENV=local` on the VPS (OBSERVED in its `.env`) makes the FAKE provider and test keys available there. It must change before real customers use that host.
- UNKNOWN: VAT on these supplies, and whether an invoice with no quote meets the terms for each service type (accountant, counsel).

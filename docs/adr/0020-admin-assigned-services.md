# ADR-0020 · Admin-assigned services and the payment page

Status: accepted. Source: owner brief of 31 Oct 2026 (plan J6). Extends ADR-0015 (service requests) and ADR-0006 (commercial documents).

## Context

Today a service request starts with the customer, and an invoice needs a request plus an accepted quote. Staff also sell by phone: they agree a hotel, CIP or visa service with a customer and need to put it on that customer's account so it can be quoted, invoiced and paid.

## Decision

- **`POST /v1/admin/customers/:id/assignments`** (permission `service.assign`, privileged because it sets prices) creates a normal service request **on behalf of the customer** (`submittedVia = CONSOLE`, the customer's own verified phone as contact), then runs the usual path: party screening, claim, and the staff quote (`send_quote` with SERVICE_FEE / THIRD_PARTY_FEE lines). If screening holds or blocks the request, it stays held or declined and **no quote is sent** and the quote in the body is not stored; the response says so (`quoteSent: false`) and, after the officer releases the case, staff send the quote through the normal service-request transition. CIP at IKA is such a REVIEW policy today, so every assigned CIP is held first. Compliance policies are never bypassed.
- The customer then sees the request and the sent quotation, accepts it (or staff record acceptance), and staff issue the invoice with the existing `POST /v1/admin/requests/:ref/invoices`. Nothing skips acceptance and no invoice is built from free-typed amounts.
- **Payment success never implies a booking** (rule 3). The payment page shows an invoice, not a reservation.
- **Payment page view** (`PaymentPageView`, `packages/contracts/src/payments.ts`): invoice number, issuer (company particulars from settings; UNKNOWN fields stay null), due date (the invoice expiry), line items with quantity, unit amount and total, currency, customer name, request reference, status, PDF document id, and either `payUrl` (only when online payment is offered for that invoice) or `offlineInstructions` from `settings.payment.offlineInstructions` (null while UNKNOWN).
- **`GET /v1/billing/purchasable`** lists the signed-in customer's own items awaiting payment or acceptance (issued unpaid invoices and quotes that can be accepted).
- **Email/SMTP credential**: vendor `email:smtp` (host, port, user, pass, optional secure and from) in `vendor-schemas.ts`, write-only in the Developer Panel. `EmailSender` reads `email:smtp`, then `email:brevo`, then the environment `SMTP_URL`. The environment value remains only as the last fallback (Mailpit locally, the staging mail catcher); a deployed host is meant to run on the Developer Panel credential.

## Consequences

- Four-eyes above a threshold (plan J6) is not added: the existing quote and invoice rules already apply to amounts, and the threshold would be an invented number. Raise it with the owner if wanted.
- Online card payment for SERVICE invoices remains governed by the ONLINE_PAYMENT policy (`product:FLIGHT|CARGO` only today), so most assigned services will show offline instructions until a policy allows SERVICE.

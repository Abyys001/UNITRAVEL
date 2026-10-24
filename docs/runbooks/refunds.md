# Runbook: refunds of online card payments

ADR-0007 P10 (test mode only). Offline payments (bank transfer, cash, card terminal) are not refunded by the system; the finance process outside it applies.

## Who can do what
| Action | Permission | Notes |
|---|---|---|
| Request a refund | `payment.refund.request` (admin, owner) | Invoice must be PAID with a verified CARD_ONLINE payment. Reason code required; "Other" needs a note. |
| Approve or reject | `payment.refund.approve` (admin, owner) | Above the four-eyes threshold only. Step-up for approval. The approver must be a **different** person. |
| Resend a payment link | `commercial_document.issue` | For an ISSUED invoice; re-sends the invoice message whose link opens the Pay button. |

## Threshold
The existing four-eyes threshold (`WORKFLOW.paymentFourEyesThresholdMinor`, default 100 000 minor units = 1 000.00, edited in the Developer Panel under Request workflow) decides. A refund of that amount or less is submitted to Stripe by its requester; a larger one waits in PENDING_APPROVAL for a second person (the same rule as verifying an offline payment).

## Procedure
1. Open the request page › Invoices › the invoice › Payment panel › **Request refund…**. Leave the amount empty to refund everything still refundable; partial refunds are allowed (the sum of open and completed refunds cannot exceed the payment).
2. Above the threshold: a second staff member opens the same panel and chooses **Approve** (or **Reject** with a reason). Approval sends the refund to Stripe with the idempotency key `refund-<id>`, so a double click cannot refund twice.
3. The refund stays SUBMITTED. **Nothing else changes until Stripe's `charge.refunded` event is verified.** Then the payment record's `refunded_minor` grows; a full refund sets the payment to REFUNDED and moves the invoice PAID → REFUNDED (history `mark_refunded`). A partial refund leaves the invoice PAID.
4. FAILED: the provider refused (the failure text shows the Stripe error type and code). Fix the cause and request again; the failed request is kept for the record.

## Audit
`refund.requested`, `refund.approved`, `refund.rejected`, `refund.submitted`, `refund.failed`, `refund.completed`, `payment.refunded`, `invoice.refunded`. Each carries the invoice number or request reference and amounts, never card data.

## Not covered
Disputes (chargebacks) open a compliance case automatically (`charge.dispute.created`) and change no state; respond to the bank in the Stripe Dashboard before the deadline. Refund timing and fees on Stripe's side, and whether a refund obliges any customer notice, are UNKNOWN until Stripe terms and counsel are confirmed. The customer is not messaged by the platform when a refund completes (no template yet).

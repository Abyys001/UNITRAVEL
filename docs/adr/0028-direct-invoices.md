# ADR-0028 · Direct invoices, invoice emails and the Stripe setup form

Status: accepted (owner brief and plan approval, 1 Nov 2026). Amends ADR-0006 C2 and C8, ADR-0004 (amounts behind sign-in, for invoice emails only) and ADR-0020 ("no invoice from free-typed amounts"). Ch. 35.1 rule 10: the booklet has no invoice object, and this changes the decisions recorded for it.

## Context

An invoice could be created only from an accepted quote, on a request's page. Staff who sell by phone could not bill a customer directly for a visa, bus or train service. The owner asked for invoices created in the Admin Panel for a chosen customer, with the services listed, emailed to the customer and payable in the portal.

## Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | Who can type amounts | Staff with the new privileged permission `invoice.direct` (owner, admin) can create and edit a **direct** invoice. Quote-based invoices still take their amounts only from the quote. Issuing and cancelling remain `commercial_document.issue` | Owner request; amounts are still frozen at issue (ADR-0006 C4) and every create and edit is audited |
| D2 | Data model | `invoices.origin` is `QUOTE` or `DIRECT`. A direct invoice has no quote (`quote_id` null, CHECK ties it to origin), `request_type = SERVICE`, and `request_id` is its own id | Payments, refunds, reconciliation and compliance cases work unchanged. A hidden accepted quote was rejected: it would record an acceptance that never happened (rule 3) |
| D3 | Reference | `UT-D-XXXXXX` | `normaliseReference` maps the letter I to 1, so `UT-I-` could not round-trip |
| D4 | Line types | `VISA, BUS, TRAIN, HOTEL, STAY, CIP, INSURANCE, TOUR, TRANSFER, OTHER`, and `DISCOUNT` as the only negative line | Flights and cargo are not line types: a typed flight invoice would skip the PAY_ON_TICKETING guard (ADR-0006 C5). They stay on the request path. `OTHER` is free text, so this rests on the form warning and the audit trail, not on a hard check |
| D5 | Compliance | At issue the customer is screened and every active SERVICE policy for a line's type applies, whatever its context. BLOCK refuses. A screening hit or REVIEW opens a case and blocks issue until released; a declined case blocks for good | Rule 5. A direct invoice has no request details, so the context of a policy such as `CIP:IKA` cannot be evaluated; applying it regardless can only be stricter |
| D6 | Due date | Optional `dueDays` (1 to 365) on a direct invoice; otherwise `invoiceValidityDays` | The invoice expires at its due date, as every invoice does (ADR-0006 C3) |
| D7 | Payment link | The link in the email opens `/billing/<number>` after sign-in; the Pay button there creates the single-use Checkout session for the exact amount. No Stripe Payment Link and no Stripe Invoicing | Payment Links are reusable and not tied to one invoice; Stripe Invoicing would duplicate our numbering and state machine |
| D8 | Invoice email (amends C8 and ADR-0004) | Emails for `invoice.issued` and `payment.requested` carry the services, the total, the due date and the PDF attachment, for **all** invoices. SMS, push and inbox stay free of amounts. Only the customer's verified email receives them | Owner decision. This accepts that an amount can sit in a mailbox and reach the email vendor; see the DPIA |
| D9 | Offline payment on service invoices | `POST /v1/admin/invoices/:id/payments` records a payment on any SERVICE invoice with the usual payer screening and four-eyes threshold; verification settles it | No route existed, and `verifyPayment` never settled a SERVICE invoice: a gap for ADR-0020 invoices as well |
| D10 | VAT | No VAT lines until `vatTreatment` is set | ADR-0006 C7 is unchanged; UNKNOWN stays UNKNOWN |
| D11 | Stripe setup | The Developer Panel keeps the only entry point for secrets (rule 6). It gains a setup checklist, the events to subscribe to and an optional connected account id (`acct_…`). The Admin Panel has no settings page, so its read-only status is the online-payment readiness shown on each invoice. With an account id set, session, retrieve and refund calls carry it and webhook events from any other account are refused | The owner connects their Stripe after this is built, and can choose Connect or a plain account then without a code change |

## Not changed

- Live mode stays BLOCKED in code (ADR-0007). Live keys are refused.
- Online payment for SERVICE invoices stays governed by the `ONLINE_PAYMENT` policy. The policy key format now accepts `product:SERVICE`, but no migration adds an ALLOW row: a compliance officer adds it on the policy screen and an owner approves it. Until then customers see offline instructions.
- Mobile gets no work (ADR-0026).

## Consequences

- Clear Valkey `perm:*` after deploy (new permission).
- Staff-edited email templates are kept: the migration only updates rows nobody has edited.
- INFERRED, needs the accountant or counsel: whether an invoice with no quote and no acceptance meets the terms for each service type.
- Connect is not verified against real Stripe until the owner connects a test account.

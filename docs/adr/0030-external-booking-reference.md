# ADR-0030 · External booking reference on a reservation

Status: accepted (owner approval, 2 Nov 2026). Amends the reservation guard in ch. 27 of the booklet. Ch. 35.1 rule 10: the booklet requires a record locator, and this changes that.

## Context

The booklet guard for recording a reservation requires a 6-character PNR (`recordLocator`). Uni Travel books in external panels (consolidator and supplier portals), and some of them return only the panel's own booking reference, not an airline PNR, until ticketing. Staff cannot record those bookings today without inventing a locator, which would put false data on the reservation (rule 2) and in the customer's itinerary.

## Decision

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | What a reservation needs | A `recordLocator` (same 6-character format as before) **or** an `externalReference` (1 to 64 characters, trimmed), plus an optional `note` (up to 2000). At least one of the two is required | The record states what the panel actually gave us and nothing more |
| D2 | Read model | `recordLocator` is nullable; `externalReference` and `note` are nullable fields on the reservation view | A reservation with only a panel reference must not show a made-up PNR |
| D3 | Tickets | Unchanged. Tickets still need the invoice to be PAID and 13-digit ticket numbers (ADR-0006 C5, ch. 27.6) | A reference is not a ticket. Payment success still never implies a booking (rule 3) |
| D4 | Booking | Our app never books. Staff book in the external panel and record the result here | Rule 1 and the "not a booking" acknowledgement in ch. 11.3 |

## Consequences

- Contracts: `ReservationBody` and `ReservationView` change as above; the API and DB must store `externalReference` and `note` and allow a null `record_locator` (a migration owned by the implementing stream).
- Code that assumed a non-null `recordLocator` (console records view, emails, PDFs) shows the external reference when the locator is null.
- A reservation without a PNR is not matched against airline locators; the PNR mismatch check (`mismatchReason`) applies only when a locator is present.
- Staff can still enter a PNR later by recording the airline locators; nothing here lets a ticket be issued without payment.

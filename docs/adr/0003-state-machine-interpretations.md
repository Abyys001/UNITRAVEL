# ADR-0003 · State machine interpretations

Status: accepted (build decision, 22-23 Oct 2026). Owner confirmation owed with the other ADRs.

Context: booklet ch. 13.3 Table 13.1 (flight commands) and ch. 14.5 (cargo lifecycle, a figure plus a state table, no command table) leave some transitions implicit. Ch. 35.1 rule 10 requires an ADR for deviations; these are interpretations rather than reversals, recorded so tests and reviewers know the intent. Code: `packages/domain/src/flight-request.ts`, `packages/domain/src/cargo-request.ts`; both are transition tables with guards and are covered by property tests (ch. 32.2).

## Flight requests

| # | Code behaviour | Booklet | Rationale |
|---|---|---|---|
| F1 | `decline_quote` (customer): QUOTED -> IN_REVIEW, guard: an open (SENT) quote exists | Not in Table 13.1; ch. 13.6 gives quotes a DECLINED status | The quote status needs a customer path; returning to IN_REVIEW lets staff re-quote without reopening. Quote becomes DECLINED |
| F2 | `send_quote` allowed from IN_REVIEW, QUOTED and ACCEPTED (booklet: IN_REVIEW only) | Ch. 13.6: sending a new quote supersedes the previous one; a price change after acceptance always needs a new quote version and a new acceptance | Revised quotes need a legal origin state. Re-quoting from QUOTED supersedes the open quote; from ACCEPTED it supersedes the accepted one and the request returns to QUOTED, requiring fresh acceptance. Never allowed once RESERVED |
| F3 | `decline` allowed from every non-terminal state except TICKETED | Table: "any non-terminal" | A ticketed booking cannot be declined; it is handled as after-sales (reference type A, ch. 13.4). EXPIRED and COMPLIANCE_HOLD may be declined. Reason code and customer message required |
| F4 | `cancel_by_customer` from SUBMITTED, COMPLIANCE_HOLD, NEW, IN_REVIEW, AWAITING_CUSTOMER, QUOTED, ACCEPTED, EXPIRED | "before RESERVED" | Literal reading: every state before RESERVED, including EXPIRED. No customer cancel after reservation |
| F5 | Staff `cancel` from the same states plus RESERVED; blocked while the reservation is HELD or CONFIRMED; reason code required | "before TICKETED"; "Active reservation must be cancelled first (recorded)" | Guard reads the recorded reservation; a LAPSED or CANCELLED reservation does not block |
| F6 | `expire_reservation` is a system command, guarded: deadline passed AND reservation marked LAPSED by admin or supplier | Table: "Deadline passed and reservation marked lapsed" | The platform never infers a lapse from the clock alone (no supplier truth); staff or a supplier event marks it |
| F7 | `record_acceptance` (staff, verbal) requires a note of at least 3 characters with the call time; `accept_quote` requires every traveller's passport details | Guards "note with date/time of call"; "traveller documents complete" | Minimal enforceable form of the guards; the call date/time is stored as structured data alongside the note |
| F8 | `record_tickets`: every traveller needs one ISSUED ticket AND payment PAID or an owner-approved credit override | Table | Credit override is a flag set by an owner; the guard does not decide payment amounts |
| F9 | `send_quote` guard rejects any option with an UNKNOWN attribute (baggage, change, refund) and a validity in the past | "every option has known baggage and conditions; expiry in future" | Implements the tri-state truth model (ch. 35.1 rule 3): conditions are never inferred |
| F10 | `reopen` only from EXPIRED, to IN_REVIEW | Table | Other terminal states stay terminal |

## Cargo requests

| # | Code behaviour | Booklet | Rationale |
|---|---|---|---|
| C1 | Command table authored from the ch. 14.5 figure and state table (29 commands). Names mirror flight commands where the meaning is the same (claim, assign, request_info, respond, send_quote, accept_quote, record_acceptance, close, decline, cancel, reopen) | Figure only | Same shape as flights keeps admin and test tooling uniform |
| C2 | `send_quote` allowed from IN_REVIEW and QUOTED (re-quote supersedes). Not from ACCEPTED | Ch. 14.6: same versioning and expiry behaviour as flight quotes | After acceptance cargo is booked with a partner; price changes go through the re-weigh exception path (C5) instead |
| C3 | `decline_quote` (customer): QUOTED -> IN_REVIEW | Not shown | As F1 |
| C4 | `receive` computes the next state: if the change in chargeable weight exceeds the lane tolerance (default 5%, `cargo.reweigh_tolerance_pct`) the result is EXCEPTION with reason REWEIGH, otherwise RECEIVED | Ch. 14.5 | The tolerance is configuration; the transition target is a function of facts, so the table stays declarative |
| C5 | `resolve_exception` for reason REWEIGH is blocked until the customer has accepted a revised quote after the exception (`accept_revised_quote`, by the customer, valid and unexpired SENT quote). The shipment resumes at the recorded `exceptionResumeTo` state, default RECEIVED | "The admin issues a revised quote, which the customer must accept before the shipment proceeds" | Makes "must accept" a guard rather than a convention. Non-REWEIGH exceptions (held, damaged, lost, returned) are resolved by staff with a recorded reason; `accept_revised_quote` refuses them |
| C6 | `raise_exception` allowed from BOOKED through OUT_FOR_DELIVERY, reason required | "Held, damaged, lost, returned or re-weighed" | Fulfilment states only; before booking there is nothing to except |
| C7 | `cancel` (staff) from every state before RECEIVED, including BOOKED, AWAITING_HANDOVER and EXPIRED; `cancel_by_customer` excludes BOOKED and AWAITING_HANDOVER | "Cancel only before RECEIVED" | Once a partner booking exists the customer must ask staff, so partner cancellation fees and slots are handled by a person |
| C8 | `decline` allowed from non-terminal states except fulfilment states (BOOKED to OUT_FOR_DELIVERY) and DELIVERED; reason code and customer message required. `screen_prohibited` (system) moves SUBMITTED straight to DECLINED, the automatic exit for prohibited goods (ch. 14.4) | "Exits from any non-terminal state" | After the goods are in the partner's hands, ending the request is cancellation or exception, not a decline |
| C9 | `clear_customs` AT_CUSTOMS -> OUT_FOR_DELIVERY; `out_for_delivery` also directly from IN_TRANSIT | Figure | The figure shows one path through customs; the direct edge lets staff skip AT_CUSTOMS when no customs hold applies instead of recording a false state |
| C10 | `deliver` requires proof-of-delivery name; `record_booking` requires a partner that serves the lane and service and is compliance-cleared, and a valid AWB if one is given | Ch. 14.8/14.9 | Partner clearance is data (ch. 27); AWB format validation in `packages/domain/src/formats.ts` |

## Consequences
- Tests in `packages/domain` assert these interpretations (properties and examples); API e2e covers the flows.
- If counsel or the owner requires stricter or looser behaviour (for example allowing customer cancellation after booking), change the transition table and update this ADR; do not special-case in services.
- The booklet's Table 13.1 should be amended in a future revision to list `decline_quote` and the extended `send_quote` origin states.

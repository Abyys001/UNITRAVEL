# ADR-0047 · Manual-courier consignments, pricing rules, customs review, shipping dashboard

Status: accepted (owner brief of 19 Nov 2026, "complete international postage & shipping management system"; owner decisions the same evening: **no courier API integrations, use the manual courier**; shipping stays **staff-priced**). Builds on ADR-0042/0046 and booklet ch. 14. Stage record: `docs/stages/STAGE-34.md`.

## Context

The brief asks for courier APIs, rates, labels, customs, tracking, a dashboard and a customer section. The owner chose to keep couriers manual: staff book with the courier (its website, phone or counter) and record the result. Cargo stays request → review → quote → fulfil (booklet 14.1/14.6): no instant customer prices, so no change to that model.

## Decision

1. **No courier APIs.** Couriers are the existing `partners` (type COURIER/…, integration MANUAL). Nothing calls a courier; no courier credentials are stored. Tracking stays staff/agent entered (ADR-0042/0043). Adding an API courier later needs its own ADR.
2. **Consignments.** Table `cargo_consignments`: one row per handover to a courier for a request: shipment number `SH-000001` (sequence), direction (OUTBOUND / RETURN), courier (partner), service level (ECONOMY, STANDARD, EXPRESS, PRIORITY, NEXT_DAY, SAME_DAY, FREIGHT, PALLET), tracked, signed-for, the courier's own tracking number and tracking URL, ship date, estimated delivery, courier cost (minor + currency), optional courier label PDF (uploaded, stored INTERNAL, virus-scanned like other uploads), status (BOOKED, DISPATCHED, CANCELLED) and cancel reason. Staff with `cargo_request.transition` create, update, mark dispatched and cancel; every change is audited. A consignment never changes the request's state: state still moves only through the cargo commands (rule 4). The customer sees courier name, service level and the courier tracking link once the consignment is DISPATCHED (never the cost).
3. **Pricing rules (staff only).** Rate cards (ADR-0046 D4) hold the **courier cost**. They gain `markupPct` and `marginFixedMinor`; the calculator shows cost and customer price side by side. Table `cargo_customer_rates` gives a customer a discount % (or a different markup) for a lane/service or for all. Customer prices remain estimates that staff put into the normal cargo quote (booklet 14.6, partner cost stored on the quote); nothing is charged from the calculator. Viewing cost needs `pricing.read.internal` or `cargo_request.read.any`; editing needs `pricing.write`.
4. **Customs review.** `cargo_customs_reviews`: a staff member reviews the declared items (CN22/CN23 from ADR-0046 D5), sets export reason, incoterms (DAP/DDP) and duties payer, and approves; editing items after approval clears the approval. A consignment for an international lane can be marked DISPATCHED only with an approved review. Commercial and pro-forma invoice PDFs are generated from the same data (booklet 14.9: the commercial invoice remains the customer's responsibility; ours is the template, signed by the sender).
5. **Shipping dashboard** (`/cargo/dashboard`): for a date range, counts by milestone (awaiting dispatch, in transit, delivered, delayed = past estimated delivery and not delivered, customs issues = at customs over 48 h or held; customs awaiting approval = not yet dispatched without an approved review, failed deliveries, returned), revenue (accepted cargo quotes' totals), courier cost (consignment costs, falling back to the quote's partner cost) and profit, per currency, with a daily chart.
6. **Customer portal.** The existing `/shipments` page and public tracking show the courier, service and courier tracking link of dispatched consignments.

## Consequences

- Migration `0038_cargo_consignments.sql`; no new permissions.
- The brief's courier list, live rates and courier-generated labels are out of scope by owner decision.

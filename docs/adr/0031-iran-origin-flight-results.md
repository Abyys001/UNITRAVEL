# ADR-0031 · Show Iran-origin flight results, held for compliance review

Status: accepted (owner decision in session unitravel-5d, 2 Nov 2026: "i want iran origin flights too"). Supersedes ADR-0029 A10 (Iran-origin searches produce no customer results). Does not change STAGE-0 item 1 ("Selling itineraries from Iran", BLOCKED pending counsel) or item 2 (Iranian carriers BLOCK).

## Context

Uni Travel's core market is travellers leaving Iran. ADR-0029 A10 hid every Iran-origin result (for example IKA→IST) while Iran lanes are disabled pending counsel. Stream A found (OBSERVED, STAGE-22 hand-over, 2 Nov 2026) that the flight engine does not apply the `IR:*` lane policy at all, so the A10 rule was not enforced in code and its test is skipped. The owner wants customers to see Iran-origin schedules and ask for them.

## Decisions

| # | Decision |
|---|---|
| I1 | **Search shows Iran-origin and Iran-destination itineraries** from any provider, subject to every other policy. |
| I2 | **Carrier policy unchanged.** Iranian carriers (`country:IR` and each Iranian airline code) stay BLOCK; such itineraries are never shown. |
| I3 | **Lane policy becomes REVIEW for flights, as data.** The engine applies lane policies to flights (closing the gap Stream A found). The flight `IR:*` lane is set to REVIEW through the compliance policy screen by authorised staff with the normal approvals, not hard-coded. BLOCK on a lane still hides results. |
| I3a | **Flight lane key convention.** Lane policies have no vertical field, so flight lanes are scoped by key prefix: `FLIGHT:IR:*` applies to flights only; unprefixed keys (`IR:*`) stay cargo/service and the flight engine ignores them (the generic `IR:*` row is seeded everywhere and would otherwise flag production flights without a staff decision). The engine checks the country pair of every slice, segment and technical stop and sets `Itinerary.complianceReview` (default false). Local seed only: `FLIGHT:IR:*` REVIEW, `seededPendingCounsel`. Deployed hosts: staff create `FLIGHT:IR:*` in Compliance › Policies; until then results show without the flag, and I4 still holds every such request. |
| I4 | **Every request touching an Iranian airport goes to COMPLIANCE_HOLD** on submit (existing state, ADR-0003). No quote, invoice, payment or reservation until staff clear the hold, recorded in `request_status_history` and the audit log. |
| I5 | **Customer wording** (en/fa): results touching Iran carry "Our team reviews trips to or from Iran before confirming anything." No promise of availability or price. |
| I6 | **Counsel item stays open.** Clearing a hold is a business decision taken by staff while STAGE-0 item 1 is BLOCKED; the hold screen shows that warning. Online payment stays off (D-03). |

## Consequences

- Owner accepts the legal risk of displaying and taking requests for Iran-origin travel before counsel answers STAGE-0 item 1.
- The skipped Iran-origin test is replaced by: shown with REVIEW lane, hidden with BLOCK lane, Iranian carrier always hidden, submit → COMPLIANCE_HOLD.
- Implementation: engine lane filter and flag (Stream A, `packages/engine`, search projection); hold warning and wording (Streams B/C); policy data change through the UI, logged.

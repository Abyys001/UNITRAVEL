# STAGE-26 · Flights → request → services → invoice → payment

Status: built and verified on branch `feat/flights-requests-invoices` as STAGE-23; merged into main on 4 Nov 2026 and renumbered STAGE-26 (23 visa, 24 catalog, 25 FlightAPI). Migration renumbered 0021 → 0024. Owner approval: 2 Nov 2026 (`docs/build/MASTER_PLAN.md`, option (a): build on the existing modules). Recorded verification replaces the stage gate (rule 9).

- Scope and plan: `docs/build/MASTER_PLAN.md`. Streams: `docs/build/STREAM_{B,C,D}_REPORT.md`. Stream A is STAGE-22 (ADR-0029, ADR-0031 engine part).
- Verification: `docs/build/VERIFICATION_REPORT.md`. Runbook and demo script: `docs/build/RUNBOOK.md`.
- Decisions: ADR-0030 (external booking reference without PNR), ADR-0031 (Iran-origin flight results shown and held for review). Owner decisions on 2 Nov 2026: Stripe Checkout kept (ADR-0028 D7), `payments.online.enabled` stays off, `BAGGAGE` line type, daily Stripe drift report (report only), ATOL `PAY_ON_TICKETING` kept.
- Migration: `0024_stage23_service_catalog.sql` (hand-written). Permission: `service_catalog.manage` (admin, owner).
- BLOCKED: Stripe test-mode flow (keys not yet entered); live Stripe (D-03); counsel on STAGE-0 item 1.

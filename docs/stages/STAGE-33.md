# Stage 33 record: cargo operations: tracking numbers, labels, drivers, public tracking, milestone emails (19 Nov 2026)

Source: owner brief of 19 Nov 2026 ("Cargo Management, Shipping Labels & Live Tracking", for admin.unitravels.co.uk and the customer site). Decision: ADR-0042. Builds on Stage 5 (ch. 14), Phase E (STAGE-9), ADR-0003 C-rows; narrows ADR-0025 for cargo tracking numbers only. Not part of the booklet.

## Later the same day (owner requests)
- **Agents (ADR-0043)** replace drivers everywhere: Agent Management (IDs, types, responsibilities, photo, public name, acceptance, activation), profile page with performance and activity, one or several agents per job, HANDLING jobs, accept/decline, problem reports, agent identity on every tracking event and on the public page (public name only). Migration `0034_cargo_agents.sql`.
- **Staff intake (ADR-0042 D13):** admins create cargo requests for customers (`/cargo/new`, exact customer lookup or new customer). Permission `cargo_request.create.any`.
- **Recipient notices (ADR-0042 D10a):** bilingual last-mile emails to the recipient's address. Migration `0033_cargo_recipients_staff_intake.sql`.
- **Labels:** Code128 quiet zones fixed (decoded with ZXing at 203 and 300 dpi); Persian addresses and handling notes rendered with Vazirmatn right to left.

- **Staff intake for all products and tickets without identity verification (ADR-0044):** admins create flight requests for customers (Requests › New request; new or existing customer, travellers created on the account, no verification needed), services staff path no longer needs a verified phone, and tickets can be recorded for unverified travellers with a stored, audited reason. Migration `0035_staff_intake_identity_override.sql`; permission `flight_request.create.any`. e2e `staff-flight-intake.e2e.ts` 2/2.

## Built (first pass; "driver" below now reads "agent", see ADR-0043)
- **Contracts** (`packages/contracts/src/cargo.ts`, `permissions.ts`, `notifications.ts`, `defaults.ts`): tracking number, 15 customer milestones with en/fa labels, new tracking codes (DRIVER_ASSIGNED, COLLECTION_SCHEDULED, COLLECTION_FAILED, SORTING_FACILITY, DELIVERY_FAILED), failure reasons, driver/assignment/label/proof/public-tracking/ops schemas, preferred delivery date and handling instructions on the request. Permissions `cargo_job.driver` (role `driver`) and `cargo_driver.manage` (admin, cargo_admin, owner); `cargo_job.driver` is a staff surface. Events `cargo.milestone`, `cargo.milestone_important`, `cargo.job_assigned`.
- **Domain** `packages/domain/src/cargo-ops.ts`: Luhn tracking numbers, `cargoMilestone`, progress steps, `driverActions`; `out_for_delivery` and `deliver` accept `cargo_job.driver` with the `assignedDriver` guard; stage gate for the new codes.
- **DB** migration `0032_cargo_operations.sql` (hand-written; journal by hand): columns on `cargo_requests` (`tracking_number` unique + check, `tracking_number_issued_at`, `preferred_delivery_date`, `handling_instructions`); tables `cargo_drivers`, `cargo_driver_assignments` (one active job per kind, partial unique index), `cargo_delivery_proofs`, `cargo_labels`, `cargo_notifications` (unique per request and key). Seed: `driver` role, milestone and job templates.
- **API** (`apps/api/src/modules/cargo/`): `cargo-ops.service.ts` (milestone notices, public tracking, labels, detail edits, proof, ops list/stats, notice log), `drivers.service.ts` (profiles bound to the `driver` role, assignments, driver jobs and actions, image upload), `label-pdf.ts` (4×6 / A6 / A4 four-up, Code128 + QR via `bwip-js` 4.11.4), `cargo-ops.controller.ts` (public, admin, driver controllers). Tracking number issued on ACCEPTED inside the transition. `schedule_handover` now records COLLECTION_SCHEDULED (was NOTE). `DocumentsService.storeImage` (server-side, metadata stripped, scanned). Email HTML links are clickable; `smsWhenNoEmail` notify flag.
- **Console** (admin host): Cargo operations section (`/cargo` overview with KPIs, 8 buckets, search, sort, server paging; `/cargo/drivers`; `/cargo/notifications`), Shipment operations panel on `/cargo/[ref]` (tracking number, labels, driver jobs, edit details, proof, notices), driver panel `/driver` and `/driver/[id]` (actions, camera photos, signature pad); driver-only accounts land on `/driver`; en and fa strings.
- **Web**: form fields (preferred delivery date, handling instructions), public `/[locale]/tracking` and `/[locale]/tracking/[number]` (noindex, no-referrer), tracking number and milestone on Shipments and the cargo page, entry points in menu, footer, cargo hero and `/track`.
- **OpenAPI** regenerated (`packages/contracts/openapi.json`; it was also stale from earlier stages).

## Verified (OBSERVED, local stack)
- Domain cargo tests 35/35 (new `cargo-ops.spec.ts`: tracking numbers incl. property tests for typos, milestones, driver authority: a driver cannot run any other command). The pre-existing name-matcher property flake (STAGE-13 note) failed once, unrelated.
- API unit 241/241 (serialiser property test: the public view drops names, phones, emails, addresses and notes).
- API e2e `cargo-ops.e2e.ts`: the brief's 12 steps: submit from the customer API with the new fields (and a rejected preferred date) → appears in the pending bucket (search by recipient) → claim, quote, customer accepts → tracking number issued (idempotent re-issue) → book → labels in all three formats (PDF, one page per piece; A4 one sheet) → public tracking without sign-in (format with spaces, typo 404, forged signature `false`, no private data) → driver created by email and assigned → driver signs in on the admin host, sees only their job; another driver gets 404; driver gets 403 on admin routes → collection with signature → hub receive, sorting facility, depart → delivery driver → out for delivery, failed attempt (public shows it, description hidden), second attempt, delivery refused without proof, delivered with photo and signature → public shows "M. R." in fa → one notice per milestone, no duplicate keys, every milestone email SENT and in the mail sink with the tracking link → audit actions present.
- Regression: stage5, stage9 (updated: COLLECTION_SCHEDULED instead of NOTE), matrix, test-sign-in: 38/38 with the new test.
- Full API e2e: the first full run hit OTP/TOTP 429 cooldowns on the shared demo staff phones (25 + 4 errors, no assertion failures in cargo code). Re-run file by file with cooldowns: all files pass except `stage3.e2e.ts`, which fails for pre-existing reasons unrelated to this stage (OBSERVED): its benchmark searches use the fixed date 2026-11-14, now in the past, and the local `apify-google-flights` provider is enabled so `NO_SOURCES` never appears; a failed run also leaves the FAKE provider disabled (restored by hand). Interrupted runs had also left `loyalty.enabled` and `services.visa.enabled` off locally (restored; visa 12/12 after).
- Console and web typecheck clean; i18n tests 23/23. Screenshots (`.run/shots/`, local only): overview, request page, drivers, notices (1366 and 390), driver job list/job/collection form, no-access screen (en, fa); a real collection submitted through the browser with a drawn signature. Web tracking pages at 390/1280 in en and fa (`.run/shots/cargo-tracking/`).
- Labels rendered and inspected (layout, barcode, QR, handling box).

## Not done / open
- Barcode and QR were not scanned with a physical scanner (INFERRED readable: bwip-js output, checked visually).
- The "label verified" badge on the web page was not screenshotted with a valid signature.
- Console data labels from the API stay English (as the rest of the console); the driver panel chrome is translated.
- Persian text on labels: label fonts are WinAnsi; party names are Latin by contract, addresses in Persian script would be dropped on the label (UNKNOWN how often).
- Recipient (consignee) emails: notices go to the customer account only; the consignee is not a user.
- Mobile (Flutter) unchanged (ADR-0026).
- No commit.

## ADR-0045 · Agent QR sign-in and parcel scanning (19 Nov 2026)

- Migration `0036_agent_sign_in_codes.sql`; `AgentSignInService` (`apps/api/src/modules/cargo/agent-sign-in.service.ts`).
- API: `POST /v1/admin/cargo/agents/:id/sign-in-code` (cargo_agent.manage), `POST /v1/auth/agent-code` (public, 30/10 min per IP), `GET /v1/agent/jobs/by-tracking/:trackingNumber` (cargo_job.agent, own open jobs only). Public tracking returns `agentUrl` only for a signed label QR.
- Console: "Sign-in QR code" on `/cargo/agents/[id]`, landing `/agent-sign-in`, "Scan parcel" on `/agent` → `/agent/scan` (BarcodeDetector, QR + Code 128, manual entry, `?tn=`). Permissions-Policy `camera=(self)`. Web tracking: "Agent? Update this parcel".
- Verification (OBSERVED, staging 21:3x): migration applied; routes test 21/21; tsc clean (api, console, web, contracts, i18n, db); `/agent-sign-in` and `/agent/scan` 200; bad code → 401 "expired or already used"; issue and scan endpoints 401 without a session; camera header present. NOT yet run: signed-in issue → scan on a phone → redeem (needs a staff login and a phone); no e2e spec written yet.

## ADR-0046 · Postage tools (19 Nov 2026)

- NFC read in all scanners and NFC tag writing on the shipment Labels panel (Web NFC, Android Chrome); shared `components/scanner.tsx`, `lib/nfc.ts`.
- Bulk scan: `/agent/bulk` (start collection, at sorting facility, handled, out for delivery) and `/cargo/scan` (departed, at customs, cleared customs, out for delivery) through the single-parcel endpoints; `GET /v1/admin/cargo/scan/:tn`.
- Run sheet: `/agent/manifest`, `GET /v1/agent/manifest(.pdf)`, staff `GET /v1/admin/cargo/agents/:id/manifest(.pdf)`, button on the agent profile.
- Calculator + rate cards: `/cargo/calculator`, `GET|PUT /v1/admin/cargo/rates`, `DELETE /v1/admin/cargo/rates/:id`, `POST /v1/admin/cargo/calculate`; migration `0037_cargo_rate_cards.sql`. No rates seeded (business data, owner to enter).
- Customs: `GET /v1/admin/cargo/requests/:ref/customs(.pdf)`, CN22/CN23 button and missing-HS warning on the Labels panel.
- Verification (OBSERVED, staging 22:0x): migration applied; tsc clean (api, console, contracts, db); routes test 21/21; new pages 200; new endpoints 401 without a session; run-sheet PDF renders (with Persian) in the API container; cargoWeights 50×40×30 cm/5 kg → 12 kg chargeable. NOT run: signed-in flows, NFC on a real tag, customs PDF on a real request, no e2e specs.
- Incident: `pnpm --filter … add` (pnpm 12) pruned the workspace's node_modules to the console's deps; restored with `pnpm install --frozen-lockfile` in `ut-dev`.

## Merge onto main and renumbering (21 Nov 2026)

The cargo work (this record and STAGE-34) was built and deployed to staging on 19 Nov without a commit, as STAGE-27/28 with ADR-0036 to ADR-0041 and migrations 0025-0031. Upstream main meanwhile used those numbers (stages 25-32). On the owner's instruction ("push cargo thing on main") it was merged onto `2ae3550` and renumbered. Only numbers changed:

| Was | Now |
|---|---|
| STAGE-27, STAGE-28 | STAGE-33, STAGE-34 |
| ADR-0036 … ADR-0041 (cargo) | ADR-0042 … ADR-0047 |
| migrations 0025 … 0031 (cargo) | 0032_cargo_operations … 0038_cargo_consignments (journal idx 32-38, after upstream 0029) |

Conflicts resolved toward upstream's redesign (OBSERVED in code):
- The customer cargo form is upstream's five-step `CargoWizard`. The preferred delivery date and handling instructions (D-rows of ADR-0042) moved into its shipment step and review, and `toBody` sends them.
- The shipments page keeps upstream's `PortalTitle` with a "Track a shipment" link, plus the tracking number and courier rows.
- The request page keeps upstream's layout. The quote-first action, the identity override and the intake notes sit under Tickets.
- The admin nav keeps upstream's unread badges. Cargo operations and the agent dashboard are their own items, and Requests no longer matches `/cargo`.

**Existing databases.** Staging and the local database had already run the cargo SQL under the old numbers, before upstream's 0025-0031, so plain `migrate` would re-run 0032-0038 and fail because the tables already exist. They were reconciled in one transaction:
1. Apply any journal migration newer than the last recorded one, except 0032-0038.
2. Insert the `drizzle.__drizzle_migrations` rows for 0032-0038 (sha256 of each file, `created_at` = the journal `when`) without running them.

Check which old cargo migrations a database really has before recording any: staging had all seven (old 0025-0031); the local database had only old 0025-0028, so 0036-0038 were applied there, not recorded (found when `/v1/shipments` failed with `relation "cargo_consignments" does not exist`). Afterwards the staging and local schema dumps both matched a fresh database.

A database without the old cargo schema (any new one) needs nothing special: plain `migrate` runs all 38 in order.

Checks (OBSERVED, 21 Nov):
- A fresh database migrated through all 38. Its schema dump matches staging's (cargo first, then upstream) apart from staging's older monthly partitions.
- Typecheck is clean for api, console and web. Unit tests: contracts 48, i18n 24, domain 184, engine 44, db 8. API unit tests all pass except `code-integrity.spec.ts` on the host, where Node 20 lacks `Promise.withResolvers` (pdfjs). The images run Node 24.
- `openapi.json` was regenerated (381 paths, additive).

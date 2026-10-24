# Stage 9 record: Phase E, cargo tracking improvements

Source: `docs/ADDITIONAL-REQUIREMENTS.md` (Phase E), booklet ch. 14.5 (lifecycle), 14.8 (partners and handover), 25.6 and 32.2 (customer projections), 35.1 rules 3 and 4. Measured locally on 23-24 Oct 2026. No deviation from the booklet, so no ADR.

## What changed (DOCUMENTED)
- Contracts: `TRACKING_EVENT_CODES`, `TRACKING_EVENT_LABELS` (en/fa), `TrackingCorrectionBody` (`RETRACTED` withdraws an event), `EstimatedDeliveryBody`, `ShipmentView`, `ShipmentSummary`, customer `TrackingEventView` (code, label, location, time, description, `corrected`; no source, author, reason or partner id), `StaffTrackingEventView`; `CargoCustomerView.estimatedDeliveryAt`.
- Domain (`packages/domain/src/cargo-tracking.ts`, framework-free): `effectiveTimeline` (latest correction wins, a correction of a correction resolves to the original, unknown targets ignored, retraction removes), `effectiveRecordIds`, `dedupeIncoming`, `CargoTrackingPort` and `ManualTrackingAdapter` (staff entry).
- Database, migration `0005_cargo_tracking` (hand-written, journal entry added by hand): `cargo_requests.estimated_delivery_at`; `tracking_events.external_event_id`, `corrects_event_id` (self reference), `correction_reason`; unique index `(source, external_event_id)`; insert-only (`forbid_mutation` trigger plus `tracking_events` added to `IMMUTABLE_TABLES`, so `app_rw` has no UPDATE/DELETE).
- API: every staff tracking write goes through `CargoService.ingest(port)` (dedupe, `ON CONFLICT DO NOTHING`, idempotent). Customer `GET /v1/shipments`, `/v1/shipments/summary`, `/v1/shipments/:ref` (own only, 404 otherwise; accepted requests onward). Staff `POST /v1/admin/cargo/requests/:ref/tracking-corrections` (audited `cargo_request.tracking_corrected`), `PUT .../estimated-delivery` (audited `cargo_request.eta_set`; null clears). Staff detail lists every row with `effective`; the customer view is the corrected timeline. Tracking notifications now use the translated label instead of the raw code.
- Permissions: none added. Corrections and the estimate use `cargo_request.transition` (cargo_admin, admin, owner); customer routes use `cargo_request.read.own`. No grant migration, no `perm_version` bump, no Valkey clear needed.
- i18n: `nav.shipments`, `shipments.*`, `tracking.events.*` (en/fa); test pins them to the contract labels. Flutter: 25 new ARB entries via `tool/gen_arb.py` (existing strings such as `priceInQuote` untouched).
- Web (`/en`, `/fa`): "Shipments" in the main navigation and footer, `/shipments` (summary card, one card per shipment with the brand flight-path timeline, estimate labelled "Estimated delivery" with "An estimate, not a promise"), the cargo request page uses the same timeline. Components: `components/tracking-timeline.tsx`, built from the shared tokens; no existing screen restyled.
- Console: cargo detail shows the full history (superseded rows struck through, reasons, external ids), a Correct action per effective row (dialog with internal reason) and an Estimated delivery panel.
- Flutter: `ShipmentsScreen` (route `/cargo/shipments`, reached from the Cargo tab), shared `TrackingTimeline`, ETA block, request detail uses them. A sixth bottom-nav tab was not added (five already).
- OpenAPI regenerated (149 paths, was 144).

## Verification
| Check | Result | Label |
|---|---|---|
| Typecheck: contracts, domain, engine, db, i18n, ui, api, web, console | 0 errors | OBSERVED |
| Unit: domain 39 (6 new: correction semantics property tests, dedupe, manual adapter), engine 7, i18n 1 (new), api 28 (4 new: route permissions, serialiser property tests for shipment view, summary, tracking event) | all pass | OBSERVED |
| API e2e full run: 8 files, 56 tests (new `stage9.e2e.ts` 2, matrix +1) | 54 pass; 2 fail in `stage2` on `RATE_LIMITED` (OTP resend cooldown, web/console builds ran in parallel); `stage2` re-run alone 4/4 | OBSERVED |
| `stage9` e2e content | record → correct → customer sees the corrected translated label (en, fa), original absent from the customer wire, staff see original (`effective:false`) and correction with reason, audit row with before/after, retraction, ETA set/clear (customer 403, bad input 400, audit rows), summary, non-owner 404, empty list for another customer, anonymous 401, UPDATE on `tracking_events` refused by the trigger | OBSERVED |
| Web Playwright (rebuilt, `BUILD_ID` fresh) | 28/28 incl. new `shipments.spec.ts` (en and fa, RTL, estimate label, axe) | OBSERVED |
| Console Playwright (rebuilt) | 12/12 incl. new correction and estimate flow; first full run had 1 failure (`owner triages on a phone`, OTP cooldown spent by the new test's API sign-in of the owner), re-run alone passes | OBSERVED |
| Flutter `flutter analyze` | no issues | OBSERVED |
| Flutter `flutter test` (proxy variables unset, `NO_PROXY=localhost,127.0.0.1`) | 41 pass (37 before plus 4 tracking tests) | OBSERVED |

## Limits and open items
- INFERRED: the partner-duplicate case is tested through SQL (`ON CONFLICT DO NOTHING` on the unique index) and at domain level (`dedupeIncoming`), because no HTTP route accepts partner events; no real partner integration exists (out of scope). `PARTNER_API` events already display on the customer timeline.
- The external id is unique per source across all shipments (a partner's event ids must be globally unique).
- The shipments list shows requests from ACCEPTED onward; earlier requests stay under "My requests".
- Cargo web page and Flutter shipments screen are not covered by screenshots beyond `docs/screens/web/shipments-fa.png` (written by the Playwright test); Flutter web build and smoke test not rerun (BLOCKED: needs `flutter build web --release --no-web-resources-cdn`, shared serving of :4300).
- UNKNOWN: whether partners will supply event ids and an ETA; `estimatedDeliveryAt` is staff-entered only.

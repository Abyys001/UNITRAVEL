# Flight Builder staff capture: implementation design

Companion to ADR-0037. Written 19 Nov 2026 from the architecture review. File paths are relative to the repository root. Line numbers were observed on that day and may drift.

## Existing pieces this builds on
- **Offers.** `NormalisedOffer` (`packages/contracts/src/offer.ts`) carries marketing and operating carrier, `TimePoint.tz`, aircraft, bookingClass, fareBasis, tri-state baggage, conditions, `expiresAt`, base, taxes and total. It has one `seatsRemaining` int and no fare type.
- **Catalog.** Writes go through `writeSlot` (`apps/api/src/modules/catalog/catalog-write.service.ts:64`). Retirement is at :97-99 and the snapshot rebuild at :110. `currentOffers()` is at :167.
- **Catalog reads.** Customer detail: `catalog-read.service.ts:290`. Contract `PublicItineraryDetail`: `packages/contracts/src/catalog.ts:200`. Web page: `apps/web/src/app/[locale]/flights/results/[id]/page.tsx`. The catalog CTA currently sends a MANUAL prefill only (`apps/web/src/components/catalog-view.tsx:25`).
- **Snapshots.** `offer_snapshots` (`packages/db/src/schema/suppliers.ts:118`) is append-only (migrations 0001, 0026). Only the ITINERARY kind writes it (`apps/api/src/modules/requests/requests.service.ts:139-182`).
- **Credentials.** `PUT v1/dev/providers/:id/credentials` with StepUp (`dev-providers.controller.ts:106`), `setCredentials` (`suppliers.service.ts:114`). The view is write-only: `last4` is null for multi-field values.
- **Permissions.** `packages/contracts/src/permissions.ts`:
  - `PERMISSIONS`
  - `PERMISSION_CATALOGUE` (exhaustive, so each new permission needs a privileged flag)
  - `DEFAULT_ROLE_PERMISSIONS`
- **Leak test helpers.** `apps/api/src/testing/leak.ts` (`FORBIDDEN_CUSTOMER_KEYS`, `findForbiddenKeys`), `apps/api/src/serialisers.spec.ts`, `apps/api/src/routes.spec.ts` (fail-closed route table), `apps/api/test/matrix.e2e.ts`.
- **Request statuses.** Labels are config (`packages/contracts/src/defaults.ts`). The state machine (`packages/domain/src/flight-request.ts`) is unchanged.
- **Next migration** is `0027` (0026 is `append_only_deletes`).

## Migration `packages/db/migrations/0027_flight_builder.sql` (hand-written, plus journal entry)

**`flight_results`** gets these columns:
- `capture text NOT NULL DEFAULT 'FEED' CHECK (capture IN ('FEED','STAFF'))`
- `captured_by uuid NULL`
- `source_record_id text NULL`
- `verification text NULL CHECK (verification IN ('RECORDED','VERIFIED'))`

**`flight_result_fares`** holds one row per bookable class option:

| Column | Type and notes |
|---|---|
| `id` | uuid pk |
| `result_id` | FK `flight_results` ON DELETE CASCADE |
| `position` | int |
| `cabin` | text |
| `booking_classes` | text[], one per segment |
| `seats_raw` | text[], one per segment, kept exactly as written |
| `fare_basis` | text[] |
| `fare_type` | varchar(8): PUB, NEGO, TOP, VFR or OTHER |
| `fare_type_raw` | text |
| `base_minor`, `taxes_minor` | bigint NULL |
| `total_minor` | bigint NOT NULL |
| `currency` | char(3) |
| `baggage` | jsonb: per-segment tri-state checked bag plus `sourceText` |
| `conditions` | jsonb: change and refund tri-state with penalty, plus staff-only `sourceText`, `confirmedBy`, `confirmedAt` |
| `ticketing_deadline` | date NULL |
| `status` | `CHECK IN ('LIVE','STALE','EXPIRED','RETIRED')`, default LIVE |
| `observed_at`, `created_at`, `updated_at` | timestamptz |

Index: `(ticketing_deadline) WHERE status='LIVE'`.

`flight_result_pricing` keeps the cheapest LIVE total, so existing admin views work.

**`offer_snapshots`** gets `catalog_result_id uuid NULL`, `fare jsonb NULL` (staff copy with price) and `customer_view jsonb NULL` (exactly what the customer saw). The existing append-only triggers cover the new columns.

**`provider_authorisations`** columns: id, provider_id, document_ref, granted_by_name, granted_at, scope text, max_searches_per_day int NULL, expires_at NULL, recorded_by, recorded_at, revoked_at, revoked_by, revoked_reason. A trigger allows updates only when setting the revoked_* columns once. No delete.

**`flight_builder_usage_observations`** columns:
- id, observed_at
- bookings int, scan_hits int
- warning_threshold int default 45, critical_threshold int default 50
- remaining_reported int NULL
- source `CHECK IN ('MANUAL','REPORTED','ESTIMATED')`
- observer_user_id, note, created_at

It is append-only: no update, no delete (reuse the `forbid_mutation` pattern from 0001/0026).

**`flight_builder_sync_runs`** columns:
- id, trigger `CHECK IN ('MANUAL','SCHEDULED')`, scope jsonb
- status `CHECK IN ('BLOCKED','RUNNING','SUCCEEDED','PARTIAL','FAILED')`, blocked_reason text
- imported, updated, skipped, errors (int), error_detail jsonb
- actor_user_id NULL, started_at, finished_at

**`providers`** gets the row `flight-builder`: disabled, all capabilities false (as 0025 does for Aviation Edge).

**Settings key `flight_builder`** (existing settings table) holds:
- `enabled`, `panelUrl`
- `syncMode` (DISABLED, MANUAL or SCHEDULED; default DISABLED)
- `syncInterval` (HOURLY, DAILY or WEEKLY; default DAILY)
- `freshHours` 6, `staleHours` 24, `deadlineWarnHours` 48

Seeding: none. Research figures stay in the research doc. The owner may enter them as MANUAL observations.

## Contracts: `packages/contracts/src/flight-builder.ts` (exported from index)
- **Enums:**
  - `FareType` = PUB, NEGO, TOP, VFR, OTHER
  - `FbConnectionState` = DISABLED, NOT_CONFIGURED, AUTHORIZATION_PENDING, CONFIGURED, CONNECTED, AUTH_FAILED, ACCESS_RESTRICTED
  - `SyncMode`, `SyncInterval`
  - `UsageSource` = MANUAL, REPORTED, ESTIMATED
  - `FareStatus`
  - `Freshness` = FRESH, AGING, STALE, EXPIRED
- **`SeatsReported`** `{ raw: string, count: int|null, atCap: boolean }`. `atCap` is true when raw is "9", whose meaning is UNKNOWN.
- **`CapturedBaggage`** = existing SegmentBaggage plus `sourceText?: string`.
- **Inputs:**
  - `FlightBuilderSegmentInput`: carrier, flightNumber, operatingCarrier?, from, to, departLocal (ISO local datetime), arriveLocal, departTz?, arriveTz?, aircraft?, durationMin?
  - `FlightBuilderFareInput`: cabin; bookingClasses[] and seats[] (raw strings), one per segment; fareBasis[]; fareType; fareTypeRaw?; baseMinor?; taxesMinor?; totalMinor; currency; baggage[] (one per segment); change and refund, each tri-state {state: KNOWN_ALLOWED / NOT_ALLOWED / UNKNOWN, penaltyMinor?, sourceText?}; rulesText?; ticketingDeadline? (date)
  - `FlightBuilderCaptureInput`: observedAt, sourceRecordId?, segments[≥1], fares[≥1], note?, requestRef?
  - Refines: base + taxes = total when both are given, all amounts ≥ 0, array lengths equal the segment count.
- **Staff views:**
  - `StaffFare` includes price, fareType, basis and rulesText.
  - `StaffFareNoPrice` is the same without the price fields. It is used when the caller lacks `pricing.read.internal`.
  - `StaffFlightBuilderOption` holds result id, segments, fares, capture metadata, freshness and the request link.
- **Customer view:** `PublicFare` `{ id, cabin, bookingClasses, seats: SeatsReported[], baggage, conditions: {change, refund} (tri-state allowed only, no amounts), ticketingDeadline, deadlineWarning: boolean, observedAt, freshness }`. It is a strict schema. Fares are ordered by cabin then class.
- **Settings and status:** `FlightBuilderSettings`, `FlightBuilderStatus` `{ state, gate:{allowed, reason}, credentials (existing view), settings, lastRun, latestUsage, authorisation }`.
- **Authorisation:** `ProviderAuthorisationInput` and `ProviderAuthorisationView`.
- **Usage:**
  - `UsageObservationInput` and `UsageObservationView`
  - `FlightBuilderUsage` `{ observations[], latest: { ratio, level: OK|WARNING|CRITICAL|UNKNOWN, headroomEstimate, estimateLabel:'ESTIMATED', stale, observedAt } | null }`
  - Headroom estimate = critical × bookings − scan_hits, floored at 0. It is labelled an estimate.
- **Sync:** `SyncRunView`, `RefreshRequest` `{ scope: {from, to, dates[], cabin?}, confirm: z.literal(true) }`.

Edits to existing contract files:
- `catalog.ts`: `PublicItineraryDetail.fares: PublicFare[]` default [].
- `requests.ts`:
  - `CreateFlightRequestBody` gets `catalog: {resultId, fareId}` for kind CATALOG.
  - The customer snapshot view gets `fare: PublicFare | null`.
  - The admin snapshot view gets `staffFare`.
- `enums.ts`: `FlightRequestKind` gets CATALOG, `ProviderId` gets `flight-builder`, `QuoteOptionSource` gets CATALOG (if that enum exists).
- `permissions.ts`:
  - `catalog.capture` (not privileged; admin, owner)
  - `provider.authorisation.record` (privileged; owner)
- `leak.ts` forbidden keys gain: `baseMinor`, `taxesMinor`, `totalMinor` (when inside a fare), `fareType`, `fareBasis`, `rulesText`, `sourceRecordId`, `panelUrl`, `username`, `password`.

## Domain: `packages/domain/src/flight-builder.ts` (pure functions, no framework imports)
- `fbConnectionState(facts)`. Checks run in this order:
  1. DISABLED
  2. NOT_CONFIGURED (no credentials, or no panel URL)
  3. ACCESS_RESTRICTED (latest observation ratio ≥ critical)
  4. AUTHORIZATION_PENDING (no active authorisation)
  5. AUTH_FAILED (credentials invalidAt set)
  6. CONNECTED (only with a verified check within 24 h)
  7. CONFIGURED
- `syncGate(facts) → {allowed, reason}`. Requires an active authorisation (not revoked, not expired) AND `adapterPresent`, which is the constant false today. Reasons: NOT_AUTHORISED, NO_ADAPTER, DISABLED, QUOTA_CRITICAL.
- `fareFreshness(observedAt, deadline, now, settings)` → FRESH, AGING, STALE or EXPIRED. A deadline before the start of today (UTC) gives EXPIRED.
- `deadlineWarning(deadline, now, hours)`.
- `usageSummary(observations, now)` gives ratio, level, headroomEstimate and stale (observation older than 7 days).
- `seatsReported(raw)`.

## API
New controller `apps/api/src/modules/catalog/flight-builder-admin.controller.ts`, prefix `v1/admin/flight-builder`:

| Route | Permission | Notes |
|---|---|---|
| `POST options` | `catalog.capture` | Normalise, then compliance filter, then `writeStaffOption`. Optional `requestRef` links the option and adds an internal note. |
| `GET options` | `catalog.read` | Price only with `pricing.read.internal`. Filters: route, status. |
| `GET options/:id` | `catalog.read` | Price only with `pricing.read.internal`. |
| `POST options/:id/retire` | `catalog.capture` | |
| `GET usage` | `catalog.read` | |
| `POST usage` | `catalog.capture` | Records a MANUAL observation. |

New controller `apps/api/src/modules/catalog/flight-builder-dev.controller.ts`, prefix `v1/dev/providers/flight-builder` (suffixes avoid clashing with `:id/test`, `:id/runs`, `:id/usage`):

| Route | Permission | Notes |
|---|---|---|
| `GET state` | `provider.config.read` | Returns `FlightBuilderStatus`. |
| `PATCH settings` | `provider.config.write` | 409 `AUTHORISATION_REQUIRED` if syncMode ≠ DISABLED while the gate is unmet. Validates panelUrl as https with no userinfo. Never fetched. |
| `POST authorisations` | `provider.authorisation.record` + StepUp | |
| `POST authorisations/:id/revoke` | `provider.authorisation.record` + StepUp | |
| `GET sync-runs` | `provider.config.read` | |
| `POST refresh` | `provider.config.write` + StepUp + `confirm:true` | Validates scope, writes a BLOCKED run, answers 409 `SOURCE_NOT_AUTHORISED` or `NO_ADAPTER`. |

- Credentials use the existing `PUT v1/dev/providers/flight-builder/credentials` with `{username, password}`.
- The normaliser lives at `apps/api/src/modules/suppliers/adapters/flight-builder/normalise.ts`. It is pure: `normalise(input) → {offer: NormalisedOffer, fares}`. Any future adapter must reuse it.
- **Capture flow:**
  1. Run `filterOffers` with the compliance policies. BLOCK gives 422 `POLICY_BLOCKED`; REVIEW sets complianceReview.
  2. Call `CatalogWriteService.writeStaffOption()`. It upserts on identity `fb:{flightNumbers}:{departDate}` and does not touch the slot's pacer fields.
  3. If the route or date has no catalog slot, create the slot without enabling feed polling, if the schema allows. Otherwise return 422 `ROUTE_NOT_TRACKED` with a clear message.
- **Customer routes:**
  - `GET v1/flights/results/:id` adds `fares: PublicFare[]` (LIVE fares only; STALE results hidden).
  - `POST v1/flight-requests` with kind CATALOG builds the snapshot (customer copy and staff copy) and returns 409 `OFFER_EXPIRED` if the fare is not LIVE. It creates no payment, invoice or reservation.
- The quote-option endpoint accepts source CATALOG `{resultId, fareId}`. It copies the tri-state data, so UNKNOWN still blocks sending the quote.
- **Jobs** (catalog queue, `flight-builder-jobs.service.ts`):
  - `flight-builder.freshness` runs every 15 minutes. It marks fares STALE or EXPIRED, sets `is_current=false` on results with no LIVE fare, and rebuilds the slot snapshots. It makes no provider call.
  - `flight-builder.sync` is scheduled only when syncMode=SCHEDULED, through upsert or remove of the job scheduler on settings change. Its handler calls `syncGate`, writes a BLOCKED run and returns.
- **Audit events** (no amounts, no credentials):
  - `flight_builder.option.captured`
  - `flight_builder.option.retired`
  - `flight_builder.usage.recorded`
  - `provider.authorisation.recorded`
  - `provider.authorisation.revoked`
  - `flight_builder.settings.updated`
  - `flight_builder.refresh.blocked`

## UI
**Console** (`apps/console`):
- `/admin/catalog/flight-builder`: list of options with freshness, deadline and status, plus a quota banner.
- `/admin/catalog/flight-builder/new?request=REF`: capture form.
- `/admin/catalog/flight-builder/usage`: quota dashboard with charts from `components/charts.tsx`.
- Changes to existing request pages:
  - `/admin/requests/[ref]`: staff fare panel (supplier base, tax, total, fare type and basis behind `pricing.read.internal`), freshness and deadline warning.
  - `/admin/requests/[ref]/quote`: "+ From catalog option".
- `/dev/providers/flight-builder`: connection state, credentials (`SecretDialog`), panel URL, authorisation record, sync mode and interval, run history, and a Refresh button that shows the gate refusal.
- Admin nav: add a Flight Builder tab under catalog.

**Web** (`apps/web`):
- `/[locale]/flights/results/[id]`: fare picker with booking classes, seats reported, baggage with source wording, conditions and a deadline warning. The CTA links to `/request/new?catalog=<resultId>&fare=<fareId>`.
- `/[locale]/request/new`: CATALOG kind, with this success copy: "Your flight request has been submitted. This is not a confirmed booking or ticket."
- `/[locale]/requests/[ref]`: shows the snapshot fare.

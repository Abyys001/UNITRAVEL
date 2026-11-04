# Stage 24 record: flight catalog and dollar pacer (4 Nov 2026)

Sources:
- Owner spec "Flight Catalog & Refresh Pacer" and the build brief of 4 Nov 2026.
- The plan `docs/build/PLAN-flight-catalog.md`, approved by the owner the same day.
- ADR-0034. It supersedes ADR-0029 A6 and ADR-0032 B3.

This stage is not part of the booklet.

The full record is in **`docs/build/FLIGHT_CATALOG_REPORT.md`**: what was built, endpoints, settings, verification, how to test and known gaps.

## Verified (OBSERVED, local stack)
- **Typecheck:** clean in every package and app.
- **Unit tests:** engine 31/31, including the 30-day pacer simulation. Contracts 24/24. API unit 201/201. Domain 138/139; the one failure is the known name-matcher property test.
- **Catalog e2e:** 71/71. No public endpoint can reach Apify in any state, and the price-leak test covers the new endpoints and snapshots.
- **Other e2e:** matrix 25/25 and stage3 8/8. The other suites pass when run one at a time, apart from four that fail on state left in the shared dev database.
- **One live run:** build 0.1.167, all four KAYAK and resolution fields `false`, 25 rows for $0.025, no KAYAK rows.

## Not done
- No commit and no deploy. Migration 0022 is uncommitted.
- k6 has not been run.
- The account cap has not been applied (it is currently $6.00); the owner decides.

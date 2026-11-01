# Stage 20 record: live aircraft list on /flights (1 Nov 2026)

Source: owner request, ADR-0027. Not part of the booklet.

## What changed (DOCUMENTED)
- Contract `packages/contracts/src/live-flights.ts`; module `apps/api/src/modules/live-flights/`; route `GET /v1/live-flights` (public, rate limited, cached 15 s); worker poller behind `LIVE_FLIGHTS_SOURCE`.
- Web: "In the air now" section on `/flights` (`apps/web/src/components/live-flights.tsx`), en and fa, region filter, flight-code search, refresh every 30 s.
- `listings.emptyFlights` reworded so it no longer says there is no live flight source; it refers to bookable fares.
- OpenAPI regenerated.

## Not done or not verified
- Not enabled on any deployed host; see the open items in ADR-0027.
- Coverage over Iran: UNKNOWN. A single check on 1 Nov 2026 found 0 airborne aircraft within 250 nm of Tehran and Mashhad, so empty or thin rows there are expected (OBSERVED once; cause UNKNOWN).

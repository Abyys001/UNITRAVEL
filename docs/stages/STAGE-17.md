# Stage 17 record: hotel page (owner copy, 29 Oct 2026)

ADR-0017. Owner message of 29 Oct 2026 with the Persian hotel copy.

## What changed (DOCUMENTED)
- `packages/i18n`: `content/hotel-guide.ts` (15 sections, en/fa), `dl` block kind and `Term` type, `hotels.enabled` content flag, `hotels.*` UI strings (en/fa); tests: parity of ids/flags/shapes incl. `dl` codes, flag visibility, five steps, banned claims (24/7, "cheapest site", competitor name, "instantly").
- `packages/contracts`: optional hotel preferences on `AccommodationDetails` (`ACCOMMODATION_TYPES`, `ROOM_TYPES`, `MEAL_PLANS`); `services.spec.ts` (4 tests). OpenAPI is generated from Zod.
- `apps/web`: `/hotels` rebuilt (hero, on-this-page nav, why-us cards, five-step flight-path steps, price factors, cheaper stays, accommodation type cards, star ratings, room types, meal plans, check-in terms, tips, embedded request form, notice); `components/hotel-request.tsx`; `ServiceFormFrame` `embedded` mode; `Terms` renderer; `contentFlags()` reads `hotels`. e2e `site-menu.spec.ts`: hotels page off/on test replaces `/en/hotels` in the "not available" loop.
- `apps/console`: service details show the new preferences with en/fa labels.

## Checks
- OBSERVED: `tsc` clean for web, console, api; `packages/i18n` vitest 16/16; `packages/contracts` vitest 4/4.
- OBSERVED: `/fa/hotels` and `/en/hotels` rendered 200 by `next dev` against a stub `/v1/site`; with `hotels: true` every section, HowTo and DefinedTermSet present; with `hotels: false` the steps, why, request form and HowTo are absent and the guide and support link render.
- NOT RUN: Playwright e2e, axe and visual baselines (no browser download allowed in this environment; `cdn.playwright.dev` blocked); full API e2e; Flutter (no mobile change).

## Open (owner)
- Review the five sections written from industry definitions (stars, rooms, meal plans, check-in terms, tips).
- Instalments, support hours and Iranian hotels/villas stay out until decided (O8, O15, FCA lender).
- Visual baselines for `/hotels` need re-recording.

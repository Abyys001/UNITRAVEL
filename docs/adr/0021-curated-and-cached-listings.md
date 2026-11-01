# ADR-0021 · Curated and cached listings

Status: accepted. Source: owner brief of 31 Oct 2026 (plan J7, "real or empty"). Extends ADR-0015 (no provider listings for stays, rail or bus) and ADR-0014 (live data only on deployed hosts).

## Context

Service pages for flights, buses, trains and stays should show something real, but there is no live provider for buses, trains or stays, and scraped or invented offers are forbidden (rule 2).

## Decision

- **Buses, trains, stays**: staff-curated rows in `curated_listings` (migration 0018), managed with `/v1/admin/listings` (permission `listings.write`). Every public item carries `label: "INDICATIVE"`, meaning "confirmed on quote". **No price is shown unless staff entered a price and marked it quoted** (`priceQuoted = true`); otherwise the amount is not returned at all. Only `PUBLISHED` rows are public; drafts and archived rows are staff-only.
- **Flights**: `GET /v1/listings/flights` serves **only cached results from a live adapter** (the worker job `listings.warm-flights` calls `SuppliersService` for the configured popular routes when a live adapter is enabled and writes the cache). Each item carries `label: "CACHED_OFFER"` and `fetchedAt`; the page must show the fetch time. With no live adapter the answer is empty with `notice: "NO_SOURCES"`. FAKE results appear only when `sandboxAllowed()` (local/CI), labelled `SANDBOX`.
- No customer price rule changes: cached flight items follow ADR-0004 (no amounts to customers), so the cache stores route, dates, carrier, stops and duration, never fare amounts.
- Popular routes are data (setting `listings.flightRoutes`, empty by default), not code.

## Consequences

- With no Duffel/Amadeus enabled (BLOCKED until the owner supplies credentials) the flights listing is empty with `NO_SOURCES`; that is the intended "empty, not fake" behaviour.

## Update, 1 Nov 2026 (owner request)
The customer web `/flights` page no longer lists cached routes; see ADR-0027. The endpoint and the labelling rules above still apply to any client that shows them.

## Update, 1 Nov 2026 (owner request): trains and buses
The customer web `/trains` and `/buses` pages no longer show curated rows or the destination filter. Each page is a hero with From and To dropdowns of Iranian cities (`docs/reference-data.md`, "Train and bus cities") over the same `TRAIN` / `BUS` service request, with an unchanged contract. `/stays` keeps the list. `/v1/listings/buses`, `/v1/listings/trains` and the staff listing tools remain, but rows for those two verticals no longer appear on the web pages.

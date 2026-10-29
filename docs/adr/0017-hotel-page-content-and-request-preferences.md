# ADR-0017 · Hotel page content and hotel request preferences

Status: accepted (owner message, 29 Oct 2026: "I want my website to follow these instructions … components and workflow like this"). Builds on ADR-0015 (service requests and verticals) and ADR-0004 (price confidentiality). Flag `hotels.enabled`, default off (unchanged).

## Context

The owner supplied Persian copy for the hotel page: online booking ("quick, easy, reliable"), why Uni Travel, variety of hotels and apartment hotels, transparent prices, 24/7 support, cheaper hotels, a five-step booking guide, how prices are set, accommodation types, and headings for star ratings, room types, meal plans, check-in terms and tips. The copy describes a live listing site: instant results with live prices, instant voucher after payment, instalment payment through credit providers, 24/7 support, hotels in Tehran, Kish and Mashhad, and a heading copied from a competitor ("فلای تو دی"). None of these exists: no accommodation provider is contracted (O8), customers see no amounts before a quote (ADR-0004, O8b), the FAQ states there are no instalments, support hours are unconfirmed (O15), and Iranian domestic suppliers are pending counsel (O8).

## Decision

- **Content** lives in `packages/i18n/src/content/hotel-guide.ts` (15 items, en and fa with the same ids and shapes). Every heading and section of the owner's copy is kept; the wording is corrected for typos and changed only where a claim cannot be kept:
  - the workflow becomes the request flow: destination and dates → preferences → staff compare hotels and send a quote → customer chooses and accepts → pays the invoice → voucher issued once the hotel confirms;
  - "prices shown live" → "every option in your quote shows the full price, checked before sending";
  - instalments → "not available yet; will be announced here and shown on the quote";
  - 24/7 → "support in Persian and English by phone and email" (no hours);
  - destinations named: Istanbul, Dubai, Paris; Iranian hotels and villas left out until counsel answers O8;
  - the competitor name is replaced by Uni Travel.
- Sections the owner named without text (stars, rooms, meal plans, check-in terms, tips) use common industry definitions and say that rules vary by hotel. **Owner review required** (STAGE-17).
- **Flags**: service items (online, why, variety, pricing, support, instalments, steps) carry `hotels.enabled`; guide items (cheaper stays, price factors, types, stars, rooms, meal plans, check-in terms, tips) are general information and always render. The page is server-rendered for indexing (HowTo JSON-LD only when the service is on; DefinedTermSet for the glossary).
- **New block kind** `dl` (term, text, optional code such as `BB` or `4★`) in the content model, rendered by `Terms`.
- **Request preferences**: `AccommodationDetails` (manual form) gains optional `accommodationType`, `minStars` (1–5), `roomType`, `mealPlan` (`RO|BB|HB|FB|AI`) and `cheapestFirst`. Codes only; labels in en/fa catalogues (web `hotels.*`, console `svc.v.acc|room|meal.*`). Optional, so earlier requests stay valid; no migration (details are JSON).
- `ServiceFormFrame` gains an `embedded` mode for landing pages: no redirect to sign-in (a sign-in card instead), an h2, and nothing rendered when the service is off.

## Consequences

- `/hotels` is no longer a bare "not available" page: with the flag off it is a hotel guide with a link to support; with it on it adds the promise, the five steps and the request form.
- If a provider is contracted later, its listings replace the request form; the guide stays.
- Turning on instalments, stating support hours or adding Iranian destinations needs the owner (and counsel or an FCA-authorised lender where named) and a content change.

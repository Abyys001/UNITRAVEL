# ADR-0027: Live aircraft list on the flights page

- Status: superseded by ADR-0032 (3 Nov 2026: board, endpoint and poller removed). Originally accepted (owner request, 1 Nov 2026: use a source that needs no account and show customers the flights in the air on `/flights`, covering Iran, Turkey, the UAE and Europe)
- Scope: `GET /v1/live-flights`, worker poller, customer web `/flights`. Mobile is out of scope (paused).

## Context
Fares come from supplier adapters and stay disabled until Duffel is approved. The owner also wants customers to see current air traffic. Commercial feeds need an account and a licence; of the sources checked, adsb.lol is the only one that is usable with no account. It publishes its data under ODbL 1.0 (DOCUMENTED) and has a documented API with a 250 nm query radius and no area-wide call (DOCUMENTED). It returned HTTP 429 on a sixth request about two seconds apart (OBSERVED); its limit is not published (UNKNOWN).

## Decision
- **Observations, not offers (rules 2 and 3).** A separate contract with `label: "LIVE_POSITION"`. No price, availability, route or booking link. No origin or destination is inferred from a callsign.
- **Airline flights only.** ICAO airline-format callsigns, airborne, excluding light aircraft, helicopters and the source's military, PIA and LADD flags, because a private aircraft can identify a person (DPIA R20). So the list is not literally every aircraft.
- **No customer traffic reaches the source.** One worker polls one of 27 areas every 6 seconds under a Valkey lock, so a full pass takes about 3 minutes. HTTP 429 pauses polling for `Retry-After` or 120 seconds. Each area is held for 6 minutes, then expires. No position history is stored.
- **Switch.** `LIVE_FLIGHTS_SOURCE=off|adsblol`, default `off`; with `off` the page section is hidden.
- **Attribution.** adsb.lol and ODbL are linked on the page. The page states that positions can be minutes old, coverage is partial and Iran coverage is limited.
- **Regions** are rectangles and include neighbouring airspace, so they are labelled "area".

## Consequences
- Not real time: rows can be a few minutes old. Faster updates need a commercial feed behind the same contract.
- The source's terms ask production users to contact the operator and announce that an API key, obtained by feeding data, will be required later. This can stop working without notice; the page then shows "no data".
- OPEN before any deployed host enables this: contact the operator (owner); counsel view on showing Iran-area traffic and aircraft of designated carriers (counsel-owed, rule 5); ODbL share-alike review of the held data (INFERRED to apply only if a derived database is published).

## Update, 1 Nov 2026 (owner request)
`/flights` now shows the search form and this board only. The heading band, destination filter, "Ask our team" empty state and cached routes (ADR-0021) were removed from the page; `GET /v1/listings/flights` and its worker job are unchanged. The board loads 10 rows at a time by raising `limit`, up to the contract's 200, then asks the visitor to narrow the list. It remains observations only: altitude and speed bars are scales for the written values, and no route, phase of flight or airline is derived.

# Flight Builder data dictionary

Written 2026-11-19. Sources: `EXTERNAL-FLIGHT-PANEL-RESEARCH.md` section B (panel fields), ADR-0037 and `FLIGHT-BUILDER-DESIGN.md` (UniTravel fields). Labels: OBSERVED, DOCUMENTED, INFERRED, UNKNOWN. All example values are synthetic placeholders, not real captures.

Visibility: CUSTOMER (public result and request snapshot), STAFF (admin, `catalog.read`), STAFF+PRICE (also needs `pricing.read.internal`, ADR-0004).

Contract names are in `packages/contracts/src/flight-builder.ts` unless stated; `offer.ts` is `NormalisedOffer`. Columns are in `flight_results` (FR) or `flight_result_fares` (FRF). Names follow the design and may drift from the code.

## Fields available in the panel

| Field | Availability | Panel location | Example (synthetic) | UniTravel field | Column | Visibility | Uncertainty |
|---|---|---|---|---|---|---|---|
| Validating carrier | OBSERVED | Result header "Ticketing on" | `XX` | `NormalisedOffer.validatingCarrier` | FR (offer jsonb) | STAFF | |
| Marketing carrier | OBSERVED | Segment "Airline" | `XX` | `FlightBuilderSegmentInput.carrier` | FR segments | CUSTOMER | |
| Flight number | OBSERVED | Segment "Fl#" | `XX123` | `FlightBuilderSegmentInput.flightNumber` | FR segments | CUSTOMER | |
| Operating carrier | OBSERVED when codeshare | "(by YY)" suffix | `YY` | `operatingCarrier` | FR segments | CUSTOMER | Carrier BLOCK policy checks it |
| Origin, destination | OBSERVED | Segment "From - To" | `EVN - LHR` | `from`, `to` | FR segments | CUSTOMER | |
| Departure, arrival local time | OBSERVED | Departure/arrival time, `+1` marker | `23:55 - 01:40+1` | `departLocal`, `arriveLocal` | FR segments | CUSTOMER | Timezone not shown; derived from airport reference data (INFERRED) |
| Date | OBSERVED | "Date" | `Th, 3 Dec` | in `departLocal` | FR departure date | CUSTOMER | Year comes from the search |
| Journey time | OBSERVED | "journey time (incl. stops)" | `4:20h` | `durationMin` | FR segments | CUSTOMER | |
| Stops | OBSERVED | Header count | `1` | derived from segments | FR | CUSTOMER | |
| Connection warning | OBSERVED | "Long connection times" | text | `note` | capture note | STAFF | |
| Aircraft | OBSERVED | "Equip." | `321` | `aircraft` | FR segments | CUSTOMER | IATA equipment code |
| Cabin | OBSERVED | "Class" | `Economy` | `FlightBuilderFareInput.cabin` | FRF `cabin` | CUSTOMER | |
| Booking class | OBSERVED | second "Class" column | `U` | `bookingClasses[]` | FRF `booking_classes` | CUSTOMER | One per segment |
| Seats ("Free") | OBSERVED, 1 to 9 | "Free" column | `4` | `seats[]` in, `SeatsReported {raw, count, atCap}` out | FRF `seats_raw` | CUSTOMER | "9" meaning UNKNOWN (INFERRED "9 or more"); shown as "9 or more (not confirmed)". A carrier cap (such as always 4) is INFERRED |
| Fare basis | OBSERVED | "Outbound ABC1W" | `ABC1W` | `fareBasis[]` | FRF `fare_basis` | STAFF+PRICE | |
| Fare type | OBSERVED | Facet and mini rules | `PUB` | `fareType`, `fareTypeRaw` | FRF `fare_type`, `fare_type_raw` | STAFF+PRICE | PUB, NEGO, TOP, VFR or OTHER |
| Fare family | OBSERVED, some carriers | "Economy White" | text | none (kept in `rulesText` or note) | none | STAFF | No dedicated field |
| Total price | OBSERVED | "Price (total) £" | `100.00 GBP` | `totalMinor` | FRF `total_minor` | STAFF+PRICE | proFee inclusion UNKNOWN (Q9) |
| Base, taxes | OBSERVED | "ADT ... ( = base + Tax )" | `40.00`, `60.00` | `baseMinor`, `taxesMinor` | FRF `base_minor`, `taxes_minor` | STAFF+PRICE | Base plus taxes must equal total when both are given |
| Currency | OBSERVED | `£` | `GBP` | `currency` | FRF `currency` | STAFF+PRICE | |
| Checked baggage | OBSERVED, per segment | "Baggage" | `1 piece`, `No baggage included` | `baggage[]` tri-state plus `sourceText` | FRF `baggage` | CUSTOMER | "No baggage included" maps to NOT included; absent maps to UNKNOWN |
| Latest ticketing date | OBSERVED | "Latest ticketing date is ..." | `2026-12-01` | `ticketingDeadline` | FRF `ticketing_deadline` | CUSTOMER | Timezone UNKNOWN; expiry at 00:00 UTC of the date |
| Change and refund conditions | OBSERVED as free text | "Rules" pop-up, ATPCO categories | uppercase text | `change`, `refund` tri-state; `rulesText` | FRF `conditions` | CUSTOMER (state only); STAFF+PRICE (text, amounts) | Stays UNKNOWN until staff confirms; no automatic parsing |
| Observation time | Recorded by staff | not in the panel | ISO time | `observedAt` | FRF `observed_at` | CUSTOMER | Seats and prices are valid only at search time |
| Source record id | Recorded by staff | not in the panel | `FB-EXAMPLE-1` | `sourceRecordId` | FR `source_record_id` | STAFF | |
| Agency fee (proFee) | UNKNOWN | Settings, margin slider | | none | none | | Not stored; inclusion in displayed price UNKNOWN |

## Not available: must never be invented

| Data | Status | Rule |
|---|---|---|
| Operational status (delayed, cancelled) | Not in the panel | Leave empty. Source would be Aviation Edge or a status provider |
| Actual departure and arrival times | Not in the panel | Leave empty |
| Terminals | Not in the panel | UNKNOWN |
| Cabin baggage | Not in the panel | UNKNOWN |
| Total capacity | Not in the panel | Seats reported are availability in one class, not capacity |
| Sold or reserved seats | Not in the panel | Never derive |
| Waitlist | Not in the panel | Never derive |
| Passenger identities | Not captured | Bookings lists were empty and are out of scope; never record names or PNRs in captures |
| Days of operation, historical flights | Not in the panel | Never infer |

## Example capture (synthetic)

Matches `FlightBuilderCaptureInput`. Amounts are minor units of an obviously fake value.

```json
{
  "observedAt": "2026-11-19T10:00:00Z",
  "sourceRecordId": "FB-EXAMPLE-1",
  "segments": [
    {
      "carrier": "XX",
      "flightNumber": "XX123",
      "from": "EVN",
      "to": "LHR",
      "departLocal": "2026-12-03T08:00:00",
      "arriveLocal": "2026-12-03T10:30:00",
      "aircraft": "321"
    }
  ],
  "fares": [
    {
      "cabin": "ECONOMY",
      "bookingClasses": ["U"],
      "seats": ["4"],
      "fareBasis": ["EXAMPLE1"],
      "fareType": "PUB",
      "baseMinor": 1000,
      "taxesMinor": 1100,
      "totalMinor": 2100,
      "currency": "GBP",
      "baggage": [{ "checked": "KNOWN", "pieces": 1, "sourceText": "1 piece" }],
      "change": { "state": "UNKNOWN" },
      "refund": { "state": "NOT_ALLOWED", "sourceText": "EXAMPLE TEXT" },
      "ticketingDeadline": "2026-12-01"
    }
  ],
  "note": "Synthetic example",
  "requestRef": null
}
```

The baggage object shape is illustrative: the design says `CapturedBaggage` is the existing `SegmentBaggage` plus `sourceText`. Check `packages/contracts/src/offer.ts` for the exact keys.

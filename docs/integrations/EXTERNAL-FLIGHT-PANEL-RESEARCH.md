# External flight panel research: Amadeus Flight Builder (airQuest)

Discovery date: 2026-11-19. Covers STAGE-0 workstream A1 ("read-only discovery of the Flight Builder panel", booklet ch. 6.2, ch. 31). Evidence labels per CLAUDE.md rule 7: OBSERVED (seen in the live panel during this session), DOCUMENTED (booklet or provider's own text), INFERRED, UNKNOWN, BLOCKED.

Method: a staff member signed in to the agency account in a normal Chrome session; the investigation then used page navigation, read-only searches and fare-rule pop-ups only. Nothing was booked, priced into a PNR, saved, exported, imported or changed. No credentials, session ids or personal data are recorded here. The Bookings and Booking review lists were empty, so no passenger data was seen.

This is engineering research, not legal or contractual advice.

## Update 19 Nov 2026

- The owner chose **staff capture** (ADR-0037): staff record panel options by hand in the admin panel. No automated access is built.
- The owner also decided that customers may see seat availability. This overrides the staff-only recommendation in section C. Q10 is added to the question list.
- The two login screenshots were removed from the repository root (moved to the system trash, never committed). Their only useful content was the login page layout; they showed no data fields.
- Field-by-field reference: `docs/integrations/FLIGHT-DATA-DICTIONARY.md`.

## A. Panel overview

| Item | Finding | Label |
|---|---|---|
| Product | "Amadeus Flight Builder (ex. Amadeus Fare Wizard)", built on airQuest (proQuest / Travelsoft Group) technology | OBSERVED (page titles); DOCUMENTED (booklet ch. 6.2) |
| Host | `https://abe-uk.airquest.com/aq4/` (login page `jsp/afw/AqLogin.jsp`) | OBSERVED |
| Login | Agency number / login name + password form. No CAPTCHA or MFA seen. Session id carried in the URL (`;jsessionid=`) | OBSERVED |
| Technology | Server-rendered JSP pages; navigation loads full HTML pages (GET). No JSON/XHR data API seen during navigation | OBSERVED (network log of Settings and Scan Hits pages) |
| Public API | airQuest publishes no outbound search or booking API for agencies; whether Flight Builder has one is UNKNOWN | DOCUMENTED (booklet ch. 6.2) / UNKNOWN |
| Search quota | "Scan statistics" page: Best Buy Requests per booking, warning threshold 45, critical threshold 50 scans per booking | OBSERVED |

### Main sections (top tab bar)

| Tab | Page | What it is | Changes state? |
|---|---|---|---|
| Fare search | `jsp/b/RequestMask.jsp` → results `jsp/b/FareDisplay.jsp` | Availability + priced itinerary search ("Best Buy Request"). Costs scans | Read-only, but consumes quota |
| Fare Data | `jsp/b/FareData.jsp` → `jsp/b/FareDisplayAFD.jsp` | Fare filings display (fare basis, class, base fare, tariff type). No flights, no availability | Read-only; did not consume a scan |
| Bookings | `jsp/b/office/BookingsOverView.jsp` | Agency's PNR list: filekey, last/first name, booking date, from-to, departure date, status, ticket limit; filters by PNR state (uncompleted, ordered, cancelled, completed, flown) | Read-only list; contains personal data when populated (was empty) |
| Booking review | `jsp/b/office/PnrReminderList.jsp` | PNR reminder list ("No booking was found") | Read-only |
| PNR import | `jsp/b/office/PnrImport.jsp` | Imports manually created Amadeus bookings by booking code (needs queue/branch access) | **Write action. Not used.** |
| Settings | `jsp/b/admin/Settings.jsp` | proFee (agency fee/margin), Agency Data, Scan Hits, Report | proFee/Agency Data are editable; only Scan Hits and Report were opened |
| Logout | | | Not used |

Write-capable controls seen and not touched: Book, Upsell, Offer (Excel) export, Save search, PNR import, proFee editing, margin slider OK.

## B. Available data catalogue

Fare search result (one priced itinerary, possibly with several alternative flight combinations under one fare):

| Data field | Available? | External location | Example type | UniTravel mapping | Value |
|---|---|---|---|---|---|
| Validating / ticketing carrier | Yes | Result header ("Ticketing on") | IATA code `PC`, `TK` | `NormalisedOffer.validatingCarrier` (or first segment marketing) | High |
| Marketing carrier + flight number | Yes | Segment row "Airline", "Fl#" | `Turkish Airlines (TK) 1971` | `segment.marketing.{carrier,flightNumber}` | High |
| Operating carrier | Yes, when codeshare | "(by TK)", "(by EN)" suffix | IATA code | `segment.operating.carrier` | High (carrier BLOCK policy checks operating carrier) |
| Origin / destination airport | Yes | Segment "From - To" | `IST - LHR` | `segment.origin/destination.iata` | High |
| City / country | Partly | Search autocomplete only ("Istanbul (IST) — Turkey") | text | Reference data already in UniTravel | Low |
| Terminal | No | | | stays UNKNOWN | |
| Departure / arrival local time | Yes | "Departure/arrival time", `+1` day marker | `23:55 - 01:40+1` | `TimePoint.local` (tz from airport reference) | High |
| Date | Yes | "Date" | `Th, 3 Dec` (year from search) | `departureDate` | High |
| Journey time | Yes | Header "journey time (incl. stops)", per-option "Travel time" | `4:20h` | derived duration | Medium |
| Number of stops | Yes | Header count, segments | `0`, `1`, `2` | slice segments | High |
| Connection warnings | Yes | "Attention: Long connection times in itinerary !" | text flag | staff note | Medium |
| Overnight flag | Yes (filter facet) | Left filter "with overnight" | count | derived | Low |
| Aircraft type | Yes | "Equip." | `321`, `7M8`, `32Q`, `388` | `segment.aircraft` (IATA equipment code) | Medium |
| Cabin | Yes | "Class" | `Economy` | `segment.cabin` | High |
| Booking class (RBD) | Yes | second "Class" column | `U`, `V`, `S` | `segment.bookingClass` | High (staff only) |
| **Seats available in that class** | Yes | "Free" column | integer, observed 1 to 9 | new field, see section D (today only `offer.seatsRemaining`) | **High, but capped**: never above 9 (INFERRED: standard GDS availability cap, so 9 means "9 or more"); Pegasus always showed 4 (INFERRED: carrier display cap) |
| Total capacity / sold / reserved / waitlist | **No** | | | stays UNKNOWN | not available |
| Fare basis | Yes | "Outbound UOW1W" | `UOW1W` | `segment.fareBasis` | Medium (staff only) |
| Fare family / branded fare | Yes, some carriers | "Economy White / Blue / Red", "Classic / Flex" with prices | name + price | new staff-only field | Medium |
| Total price per adult | Yes | "Price (total) £" | `120.40 GBP` | `offer.price.total` (staff only) | High (staff only) |
| Base fare + tax split | Yes | "ADT 120.40 £ ( = 52.00 £ + 68.40 £ Tax )" | money | `price.base`, `price.taxes` | Medium (staff only) |
| Currency | Yes | `£` | GBP | `price.currency` | High |
| Fare type | Yes | Facet / Mini rules: IATA (published), Nego, TOP, VFR | enum | new staff-only field `fareType` | High: separates published from net/negotiated |
| Agency fee / margin applied | UNKNOWN | Margin slider (0) and Settings → proFee | | whether displayed prices include proFee is UNKNOWN | Must be confirmed before any price is used |
| Checked baggage | Yes, stated per segment | "Baggage": `25 kg`, `20 kg`, `1 piece`, "No baggage included" | weight / pieces / none | `baggage.checked` tri-state: stated value → KNOWN; "No baggage included" → NOT_INCLUDED | High |
| Cabin baggage | No | | | stays UNKNOWN | |
| Latest ticketing date | Yes | "Latest ticketing date is 19.11.2026" | date | `offer.expiresAt` candidate (staff only) | High: some fares expire the same day |
| Mini rules icons | Yes | PUB, clock, stops, baggage, FEE icons | icons | none (summarised elsewhere) | Low |
| Fare rules (penalties, changes, refunds) | Yes | "Rules" pop-up `jsp/b/WebqueryRules.jsp`, ATPCO categories (RU, SR, AP, SU, SE, CD, OD, FL, HI, TF, SO, CO, PE, VC, VR, TE) as free text | uppercase free text | `conditions.change/refund`: keep UNKNOWN unless a staff member confirms; store raw text staff-only | High for quotes, but needs human reading |
| Operational status (delays, cancellations, actual times) | **No** | | | stays UNKNOWN | not available |
| Historical flights | **No** | | | | not available |
| Schedule frequency / days of operation | No (only per-date search) | | | | |

Fare Data result (`FareDisplayAFD.jsp`), per filed fare: tariff (PUB / TOP), carrier, fare without tax, tax (shown as `?`), passenger type, fare basis, booking class, open-jaw flag, outbound/inbound, rules link. 1011 fares for one city pair and date. No flights and no seats. OBSERVED.

Agency statistics (Settings → Scan Hits / Report): number of bookings, number of Best Buy Requests, ratio, thresholds, remaining requests; booking report (bookings, passengers, segments per hour over a period). This is the agency's own usage data, not flight data. OBSERVED.

## C. Data quality

| Field | Always present? | Freshness | Reliability | Operational or indicative? | Customer-facing search? |
|---|---|---|---|---|---|
| Carrier, flight number, airports, times, equipment | Yes on every result | Live at search time (INFERRED: availability-driven search) | High | Scheduled, not operational | Yes, as schedule-basis information (no price, no seats), after carrier/lane policy |
| Booking class + "Free" seats | Yes | Live at search time; changes minute to minute | Accurate but capped at 9 and carrier-capped (e.g. 4) | Bookable inventory signal, not capacity, not a hold | No numbers to customers. At most a staff-reviewed "limited availability" hint, which needs its own ADR |
| Price, base, tax, fare type | Yes | Live at search time; ticketing deadline can be the same day | High for that moment; may include agency fee (UNKNOWN) | Indicative for UniTravel (never a quote) | **Never** (ADR-0004) |
| Baggage | Yes per segment | Live | Stated by the fare; "No baggage included" is explicit | Fare condition | Only as tri-state through the existing quote path |
| Fare rules | On demand per fare | Live | Authoritative text, unstructured | Fare condition | Staff reading only; change/refund stay UNKNOWN until confirmed |
| Fare Data filings | Yes | Filed fares | High, but no availability | Fare filing | No |

## D. Feature recommendations

| Feature | External data required | Already supported? | Recommended action | Priority |
|---|---|---|---|---|
| Staff look-up of net/negotiated fares for a live customer request | Fare search result + rules | Manual: staff use the panel today | Keep manual. Optionally add a structured "paste or record" form so staff can attach the chosen option (carrier, flights, class, seats seen, baggage, ticketing deadline) to the request | P0 |
| Contracted Amadeus API (Master Pricer search, informative pricing, fare rules) | Same data via an official interface | Adapter `amadeus-enterprise` placeholder (BLOCKED) | Ask the Amadeus UK account manager the ch. 6.2 questions plus the automation question in section F | P0 |
| Seat-availability by booking class in the staff catalog | RBD + "Free" seats | No (only `offer.seatsRemaining` in jsonb, never set by a live source) | Design a staff-only `flight_inventory` (per flight, RBD, seats, observedAt, source) with append-only history, once a permitted source exists | P1 |
| Fare type (PUB / NEGO / TOP / VFR) on staff offers | Fare type | No | Staff-only field on the offer when a permitted source exists | P1 |
| Ticketing deadline on staff offers | Latest ticketing date | `expiresAt` exists | Map when a permitted source exists | P1 |
| Fare families (branded fares) | Brand names + prices | No | Staff-only list on the offer | P2 |
| Structured penalties from fare-rule text | Rules text | No | Staff confirms; no automatic parsing into customer-visible conditions | P2 |
| Scheduled catalog sync from the panel | Fare search on a timer | No | **Not recommended**, see section F | — |
| Agency scan-quota monitor | Scan Hits page | No | Not needed if no automation runs | P3 |

## E. Missing data

| Needed by UniTravel | In the panel? | Alternative authorised source |
|---|---|---|
| Physical capacity, sold seats, reserved seats, waitlist | No | None for a travel agency; airlines do not publish it |
| Operational status (delays, cancellations, actual times, gate) | No | Aviation Edge (ADR-0036 key), an airline status API, or a flight-status provider under contract |
| Schedules by day of week / season | No (per-date search only) | Aviation Edge schedules (ADR-0036), OAG/Cirium under contract |
| Cabin baggage | No | Fare rules text; contracted GDS API |
| Terminals | No | Contracted GDS API, schedule provider |
| Iran-origin legs | Not tested (no Iranian carrier searched) | Carrier policy BLOCK applies regardless |

## F. Integration limitations

1. **Search quota (decisive).** OBSERVED at the start of discovery: 10 bookings, 478 Best Buy Requests (47.8 scans per booking), warning threshold 45, critical threshold 50, "You still can make 22 Requests". The account was already above the warning threshold. During discovery, the IST→LON search used 1 scan and the EVN→LON search used 2 scans (counter 478 → 481, 19 requests left). Opening fare rules and the Fare Data display did not change the counter. What happens at the critical threshold is UNKNOWN (likely loss of search until more bookings are made; INFERRED from "To get more scans please order bookings"). A scheduled sync across even a handful of watchlist routes would exhaust the allowance in one run and could stop staff from searching for real customers.
2. **No API.** The panel is server-rendered HTML. Automated reading means parsing HTML pages and submitting the search form: scraping and undocumented endpoints under CLAUDE.md rule 2 and booklet ch. 21.1 ("An adapter exists only for a provider Uni Travel has a contract or written permission to use"). ADR-0029's exception covers the Apify actor only.
3. **Contract.** The panel is used under the agency's Amadeus UK relationship. Whether its terms allow automated access is UNKNOWN; GDS agency terms usually restrict it (INFERRED).
4. **Session in the URL.** `jsessionid` travels in URLs; any automated client would have to keep it out of logs and errors.
5. **Freshness.** Seat counts and prices are valid only at search time; ticketing deadlines can be the same day. Stored snapshots would go stale within hours.
6. **Personal data.** Bookings and Booking review list passenger names and PNRs when populated. Reading them is outside the catalog's purpose and would need a DPIA update (docs/compliance/DPIA-draft.md).

Questions to add to the Amadeus UK account manager list (booklet ch. 6.2):

- Q7. May Uni Travel's own system read Flight Builder search results automatically under the agency account, and if so, at what volume, and how do automated searches count against the scan-per-booking thresholds?
- Q8. What happens when the critical threshold (50 scans per booking) is reached?
- Q9. Do displayed Flight Builder prices include the agency proFee?
- Q10. May Flight Builder availability (booking class and seats) be shown to end customers?

## G. Final recommendation

Use Flight Builder as a **staff tool, not an automated catalog source**:

1. Do not build a scheduled or background sync against the panel. The scan quota makes it unworkable, and it is not permitted without a contract or written permission (rule 2, ch. 21.1). This replaces section 7–9 of the original integration request until Amadeus answers Q7.
2. Keep the existing catalog sources (FlightAPI.io, Aviation Edge, Apify per their ADRs) active. Removing them from the Admin/Developer workflow now would leave the customer catalog without a source.
3. Pursue the contracted Amadeus Enterprise API (ch. 6.2) for search, informative pricing and fare rules. It returns the same fields seen here (RBD seats, fare basis, baggage, fare type) through an authorised interface, fits the existing `amadeus-enterprise` adapter slot, and its data can then feed a staff-only inventory store (section D, P1).
4. If Amadeus confirms in writing that automated panel access is allowed (Q7), a future automated adapter needs its own ADR recording the permission, volume limits and quota handling before any code. Design it as request-driven (one search when staff open a customer request), never timer-driven. ADR-0037 is the staff-capture decision and does not authorise automation.
5. Meanwhile, staff keep searching the panel by hand for each customer request and record the chosen option through the existing quote path, where UNKNOWN baggage or conditions still block sending a quote (rule 3).

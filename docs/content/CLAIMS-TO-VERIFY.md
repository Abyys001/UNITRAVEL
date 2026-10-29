# Claims to verify before publishing

Source statements in `UniTravel-Content.docx` that the product cannot support yet, or that no one has confirmed. All seeded entries stay IN_REVIEW or DRAFT; a database check blocks PUBLISHED while any claim is open (ADR-0017). Owner decisions O1 to O15 are in `docs/CONTENT-MENU-LIVE-DATA.md`; states below are from the code, ADRs and `docs/stages/STAGE-16.md`.

| Id | Claim (source) | Source section | What the product does today | Status | Decider |
|---|---|---|---|---|---|
| C1 | Ticket issued right after successful payment, available in account and by email | §2-2 | Payment never implies a booking (rule 3). `atol.mode = PAY_ON_TICKETING`: payment at ticketing; staff record the ticket; invoices and emails exist (ADR-0006, ADR-0013) | not as written (O2) | owner |
| C2 | "Cheapest and most reputable site in London", best price | §2-3 | Customers see no amounts before a sent quote (ADR-0004); comparative price claims need evidence | UNKNOWN (O4) | owner, counsel |
| C3 | Instalments and credit payment (flights §2-3, hotels §7-2) | §2-3, §7-2 | No credit provider, no deposits (`PAY_ON_TICKETING`, no PARTIAL). Stripe live is BLOCKED (ADR-0007) | not offered (O2, O3) | counsel, owner |
| C4 | Domestic and international cheap tickets; airlines from all over the world | §2-3 | Iranian-registered carriers are BLOCK (D-01); no domestic Iranian flights; supplier list depends on enabled providers | not as written (O1) | owner, counsel |
| C5 | Online refund request, penalty deducted, balance paid to the account | §2-3, §3-6 | After-sales refunds exist, staff-run, four-eyes above the threshold; "request online" fits, instant online refund does not | partly (O5) | owner |
| C6 | Price-change alerts by email or SMS | §2-3 | Not built | not offered (O4: "we tell you if a quoted fare changes") | owner |
| C7 | Visa services online end to end | §2-3 | Request flow built, `services.visa.enabled` off | awaiting counsel (O6) | counsel |
| C8 | Insurance with the ticket (checkbox on the passenger page) | §2-3 | Request flow built, `services.insurance.enabled` off; no checkbox on the flight flow; UK restrictions for persons connected with Iran noted | awaiting counsel (O7) | counsel |
| C9 | 24-hour support, even on holidays, 24/7 by phone and email | §2-3, §7-4, §7-7 | Staffing hours UNKNOWN; hours come from settings | UNKNOWN (O15) | client |
| C10 | Phone number ۰۲۰۴۵۱۱۳۲۹۲ | §2-3 | Settings hold placeholders; the support page hides placeholders and never claims 24 hours | UNKNOWN (O13) | client |
| C11 | Booking windows (7 weeks, 2 to 3 weeks, 30 days) and mid-week and off-season advice | §2-5 | General advice, no data in the product | UNKNOWN | editor |
| C12 | Filters (price, airline, class, stops, baggage) | §2-2 | Only filters the data supports are shown | partly | product |
| C13 | "Domestic" flights in titles and text | §2-2, §3 | See C4 | not offered (O1) | owner |
| C14 | Check-in 2 h (domestic) and 3 h (international) | §3-2 | Airline and airport dependent | general advice only | editor |
| C15 | Passport valid at least 6 months | §3-3 | Depends on destination | general advice only | editor, official sources |
| C16 | No name change after purchase | §3-3 | Airline dependent | verify | editor |
| C17 | Carry-on 7 to 8 kg; liquids 100 ml per container in a 1 litre bag | §3-4, §5 | Airline, airport and route dependent (brief §8.2: not universal) | verify per source | editor |
| C18 | Free fully folded stroller; one week before a lost-bag claim | §3-4 | Airline dependent | verify | editor |
| C19 | Infant under 2, child 2 to 12; medical clearance for pregnancy; pets rules | §3-5 | Airline dependent | verify | editor |
| C20 | Delay over two hours or cancellation: change or refund without penalty; charter stricter | §3-6 | Depends on airline, ticket and jurisdiction | verify | counsel |
| C21 | Hotel booking steps (filters, compare, voucher) | §7-9 | No hotel provider; request form only when `hotels.enabled` is on | not live (O8, ADR-0015) | owner |
| C22 | Voucher issued instantly; live hotel prices and capacity | §7-3, §7-6 | No hotel provider, no inventory, no live prices | not offered (O8) | owner |
| C23 | Hotels in Tehran, Kish, Mashhad, Istanbul, Dubai, Paris; villas, forest and coastal cabins, eco-lodges across Iran | §7-4 | No verified supply, no providers; Iranian domestic suppliers raise a sanctions question | UNKNOWN (O8) | owner, counsel |
| C24 | Real photos and full descriptions for every property | §7-5 | No listings | UNKNOWN | owner |
| C25 | "Special discount" hotel booking, cheapest-first filter | §7-8 | No discount programme; no hotel search | UNKNOWN | owner |
| C26 | Star definitions (e.g. 3-star: 24-hour reception, 4-star: pool and gym) | §7-12 | Generalisations; classification differs by country and property (editorial caveat added, not in source) | verify | editor |

## Editorial additions (not in the source)
- Caveat that star ratings differ by country and property (brief §9.3).
- "General guidance" notes on the rules pages (brief §8.1).
- A short ticket-types table assembled only from §3-6 and §4 (one-way, return, round trip, system and charter).
- Glossary English terms for the star ratings ("1-Star Hotel" to "5-Star Hotel"): translations of the Persian headings, the source gives none.

## Source gaps
- §4: the term "Booking" has no explanation in the source ("—"); stored with that dash and status IN_REVIEW.
- §7: the contents list names room types, meal plans, check-in terminology and "points before booking", but the file has no text for them. Nothing was invented.

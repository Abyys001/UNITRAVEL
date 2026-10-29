# Provider options by vertical

Research date: 2026-10-29 (accessed that day). Evidence labels per CLAUDE.md rule 7: OBSERVED (seen in this repo or a live page), DOCUMENTED (provider's own published text), INFERRED, UNKNOWN, BLOCKED. Third-party summaries (blogs, vendor marketing) are marked INFERRED unless stated.

This is engineering research, not legal advice. Sanctions and licensing conclusions are counsel-owed (docs/stages/STAGE-0.md section B). Nothing here authorises scraping, undocumented endpoints or bypassing authentication, bot detection or rate limits (rule 2). A provider is only added after contract, counsel view, an ADR (booklet 35.1 rule 10) and a policy-as-data entry (rule 5).

## 0. What exists in the repo (OBSERVED)

| Adapter | File | Capabilities declared | State |
|---|---|---|---|
| duffel | apps/api/src/modules/suppliers/adapters/duffel.adapter.ts | search, price, seatMap, cityCodes; `order` and `cancel` false | Implemented, seeded disabled; needs live token and written Duffel acceptance (STAGE-0 A2) |
| amadeus-enterprise | .../adapters/amadeus.adapter.ts | none; every call throws CONTENT_RESTRICTED | Placeholder; BLOCKED on contract and WSDL/REST catalogue (STAGE-0 A1) |
| manual | same file | none (staff-entered options) | Enabled, first-class path |
| fake | .../adapters/fake.adapter.ts | search, price, seatMap | Local only (ADR-0014); refuses to construct elsewhere |

Non-flight verticals (hotel, stay, train, bus) have ports in contracts but no adapter and all flags off (ADR-0015). Insurance, CIP and visa are staff-fulfilled service requests. Cargo tracking is manual with `externalEventId` dedupe (STAGE-9). Email/SMS/push vendors are already modelled (see section 7).

## 1. Flights

Common UniTravel constraints: ATOL mode is PAY_ON_TICKETING (UNKNOWN which ATOL mode applies); ticketing and cancel/refund adapters are not built, so "issue" today is staff-recorded. Baggage and fare conditions must stay tri-state (rule 3).

| Provider | Search | Book / issue | Cancel / refund | Baggage data | Sandbox | Access path | Restrictions | Recommendation | Label |
|---|---|---|---|---|---|---|---|---|---|
| Duffel | Yes (offer requests, seat maps) | Orders API; "Managed Content" = Duffel ticketing on its IATA/ARC accreditation, or BYO ticketing authority | Quote then confirm at `/air/order_cancellations`; refund to original payment or airline credits; non-API orders via Duffel staff | Per-passenger per-segment baggage on offers (the adapter maps checked/carry-on; absent field must stay UNKNOWN) | Test mode: token `duffel_test_`, own airline "Duffel Airways" (ZZ) plus some external airline sandboxes | Self-serve account; live access after KYC and verification | Services Agreement cl. 2.5(i) bars ordering from or for persons or entities in embargoed countries or on UK/OFAC/EU lists; Iran is not named; cl. 9.2(c) allows suspension. Fees: $3.00/order, 1% managed content, $2/ancillary, excess-search fee above 1500:1, 2% FX | Selected as first live source (search); add orders later behind an ADR. Get written confirmation of Iran-connected itineraries first | DOCUMENTED (terms, pricing, test mode); UNKNOWN (Turkish and Iranian-gateway carrier coverage, Iraqi/SalamAir content) |
| Amadeus Self-Service | Yes (Flight Offers Search, Hotel Search) | Flight Create Orders (consolidator-limited) | Limited | Limited | Free test environment | Portal | Press reports registration paused and portal decommissioned 17 Jul 2026, API keys disabled | Rejected (gone) | INFERRED (press and third-party; official page not confirmed) |
| Amadeus Enterprise | Yes (Master Pricer SOAP, Enterprise REST) | Yes (PNR, ticketing) with office ID | Yes | Fare-rule and baggage per contract | Contract-dependent | Request-based access; implementation fee plus monthly fees; NDA before pricing; reserved for experienced companies | Market and functionality dependent | Keep as the planned primary GDS; contract is a business decision | DOCUMENTED (Amadeus FAQ: request-based, fees, NDA); BLOCKED (contract, STAGE-0 A1) |
| Kiwi.com Tequila | Yes | Yes (virtual interlining) | Via Kiwi | Per fare | Partner dependent | Kiwi states new Tequila partners are by invitation only (statement dated May 2024) | Not self-serve; 2026 policy UNKNOWN | Rejected for now; revisit only if Kiwi invites | DOCUMENTED (invite-only, 2024); UNKNOWN (2026) |
| Travelport (Universal API / Travelport+) | Yes | Yes (GDS) | Yes | Fare rules | 30-day trial sandbox; pre-production after contract | Contract first; certification with at least 15 days' notice; production limited to contracted APIs | SOAP/XML heavy for uAPI | Alternative GDS if Amadeus contract fails | DOCUMENTED |
| Sabre | Yes (REST/SOAP) | Yes | Yes | Fare rules | Dev Studio certification environment, temporary test credentials | Current customers use credentials from the account manager; PCC-bound subset; production needs commercial agreement and certification (secondary source) | Needs PCC | Alternative GDS | DOCUMENTED (sandbox, PCC); INFERRED (production terms) |
| Others (Skyscanner, Mystifly, Travelfusion, TBO) | Not researched | - | - | - | - | - | - | Out of scope this pass | UNKNOWN |

Iran-related, factual position:
- Neither Duffel's agreement nor the Amadeus FAQ names Iran. Duffel cl. 2.5(i) is generic embargo and sanctions-list language. Whether an Iran-connected itinerary (for example Istanbul to Tehran on a non-designated carrier) is allowed under a given provider contract is UNKNOWN until the provider confirms in writing (BLOCKED, STAGE-0 A2, Q1-Q3).
- Carrier-level control stays in `compliance_policies` (Iran carriers BLOCK, rule 5). A provider contract does not override it.
- Turkey to London, Europe and Cyprus content: UNKNOWN per provider until sandbox/live searches run (STAGE-0 section F); the manual path covers gaps.

Sources (flights):
- Duffel Services Agreement https://duffel.com/services-agreement (accessed 2026-10-29)
- Duffel pricing https://duffel.com/pricing (accessed 2026-10-29)
- Duffel cancelling an order https://duffel.com/docs/guides/cancelling-an-order and https://duffel.com/docs/api/order-cancellations
- Duffel test mode https://duffel.com/docs/api/overview/test-mode
- Amadeus FAQ https://developers.amadeus.com/faq and https://developers.amadeus.com/support/faq/ ; self-service shutdown reports: https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers (page returned 403 to the fetch tool; read via search summary only), https://airlabs.co/amadeus-self-service-api-shutdown
- Kiwi.com partnership statement https://media.kiwi.com/articles-and-interviews/better-for-business-kiwi-com-takes-a-new-approach-to-partnerships/
- Travelport https://support.travelport.com/WebHelp/uAPI/Content/New_Customer_Path/NewCustomer_Trial.htm and https://developer.travelport.com/docs/getting-started/ready-to-certify
- Sabre https://developer.sabre.com/guides/travel-agency/faqs and https://developer.sabre.com/guides/travel-agency/quickstart/quick-start-checklist

## 2. Hotels and stays (no adapter exists; ADR-0015 flags off)

| Provider | Search | Book | Cancel | Sandbox | Access path | Restrictions | Recommendation | Label |
|---|---|---|---|---|---|---|---|---|
| Booking.com Demand API | Yes | Orders endpoints need separate Search, Look & Book approval | Via API per approval | Developer Portal try-out console, approved partners only | Managed Affiliate Partner contract; API key and X-Affiliate-Id from Partner Centre | Contract terms control AI use and data use; commercial case required | Candidate; apply as affiliate first | DOCUMENTED (prerequisites page); INFERRED (look-to-book detail, secondary) |
| Expedia Group Rapid | Yes | Yes | Yes | Test via restricted development mode keys | Apply as partner; key and shared secret from EPS Portal; SHA-512 signed requests; site review before production | Launch requirements include front-end UI rules | Candidate; strongest self-service onboarding | DOCUMENTED |
| Hotelbeds APItude | Yes | Yes | Yes | Test host api.test.hotelbeds.com; evaluation keys capped at 50 requests/day | Register for keys; commercial agreement and certification for live | Certification once per account (secondary source) | Candidate for wholesale B2B stays | DOCUMENTED (test, cap, commercial agreement); INFERRED (certification areas) |
| Amadeus Hotel | Yes | Yes | Yes | Self-Service (shut down); Enterprise by contract | Same as Amadeus Enterprise | - | Only if Amadeus contract is signed | BLOCKED |

Any hotel in Iran or a supplier owned by or paying an Iranian party raises sanctions and payments questions (ADR-0015, O8): UNKNOWN, counsel-owed. No provider documents an Iran policy in the pages read.

Sources: https://developers.booking.com/demand/docs/getting-started/prerequisites ; https://developers.expediagroup.com/docs/products/rapid/setup/getting-started ; https://developer.hotelbeds.com/documentation/ and https://developer.hotelbeds.com/documentation/activities/knowledge-base/certification (all accessed 2026-10-29).

## 3. Iranian rail (RAJA) and intercity bus

| Provider | Capability | API | Label |
|---|---|---|---|
| RAJA Passenger Trains (raja.ir) | Consumer ticket sales | No official public API or developer programme found in this search | UNKNOWN (absence of evidence; not confirmed by contacting RAJA) |
| Iranian intercity bus operators and terminals | Consumer ticket sales | No official public API found | UNKNOWN |
| Third-party Iranian ticket sites and foreign resellers (for example OrientTrips) | Sell RAJA tickets | They describe booking portals, not APIs | INFERRED |

Do not scrape raja.ir or aggregator sites, reuse their private app endpoints, or bypass captchas. Options that are legitimate: ask RAJA or an Iranian licensed travel agency for a written partner or reseller arrangement (sanctions and payment routes need counsel first), or keep trains and buses as staff-fulfilled service requests (current ADR-0015 behaviour: flags off, items hidden). Source: web search 2026-10-29 (no primary developer page found).

## 4. Travel insurance (UK)

| Provider | Capability | API | Access | Label |
|---|---|---|---|---|
| Holiday Extras API | Insurance schemes by scheme code | REST, docs public at https://docs.holidayextras.co.uk/hxapi/insurance/options | Account manager; agent code (ABTA) required | DOCUMENTED |
| Amadeus + Pattern | Insurance offered inside Amadeus Selling Platform for UK agents (Nov 2022) | Via Amadeus | Amadeus agency | INFERRED (2022, may have changed) |
| HelloSafe | Quote, compare, bind REST with webhooks and sandbox; private beta | REST | Partner | DOCUMENTED (vendor page); non-UK specifics UNKNOWN |
| Cover Genius, Collinson, Battleface, Staysure, Endsleigh | Not verified | - | - | UNKNOWN |

Regulatory: selling or arranging insurance in the UK is FCA-regulated (a travel agent normally acts as an appointed representative of an authorised firm, or under a connected-travel-insurance route). The search did not return a current FCA text; ADR-0015 O7 and UK SI 2026/983 stay counsel-owed. Recommendation: keep insurance as a staff-fulfilled request (flag off) until an FCA-authorised principal is chosen; then integrate that principal's API. Cover for Iran trips is likely excluded or priced by individual insurers: UNKNOWN.

## 5. Airport CIP at Imam Khomeini (IKA)

- OBSERVED/INFERRED only from third-party sites: a CIP lounge exists in a separate building and "VIP" is reported as limited to officials; services are sold by private resellers and concierge brands (airssist.com, local agencies). Some agencies say fees follow an airport price list.
- No official operator booking page or API was found. The operator (IKA airport city company or Iran Airports Company) and any official booking route are UNKNOWN.
- Status: BLOCKED for any contract (sanctions position on the operator and payment route is counsel-owed, ADR-0015 O9; seeded policy `CIP:IKA` = REVIEW).
- Recommendation: keep CIP as a staff-fulfilled service request with flag off. Do not list a price or operator until a verifiable official source exists.

Sources: https://surfiran.com/mag/all-about-cip-services-at-irans-airports/ , https://airssist.com/airport-concierge/imam-khomeini , https://rashintravel.com/iran-cip-service/ (third-party, accessed 2026-10-29).

## 6. Cargo tracking (manual plus external)

Current: `CargoTrackingPort` manual adapter, append-only corrections, `externalEventId` dedupe (STAGE-9). External tracking is an optional enrichment, not a source of truth for partner status.

| Provider | Fit | Notes | Label |
|---|---|---|---|
| 17TRACK API v2.2 | Parcel/courier tracking; lists 3400+ carriers and 190+ airlines | Register numbers (40 per call), results pushed by webhook (TRACKING_UPDATED); 200 free numbers one-time for accounts opened after 2026-01-07; billed per number, price on request. AWB support needs a carrier-code check | DOCUMENTED (docs); UNKNOWN (AWB coverage and price) |
| AfterShip Tracking API | Courier tracking, webhooks, carrier detection | Coverage of airline AWBs not confirmed in the pages read; Shopify listing shows Pro $119/month (vendor listing, INFERRED) | UNKNOWN for AWB |
| Parcels API | Lists 172 airlines and air-cargo providers; $19/month for 300 shipments (vendor pricing page) | | INFERRED |
| ShipsGo / TrackingMore | Air cargo APIs (vendor claims 160+ airlines / 90+ airlines) | | INFERRED |
| Carrier APIs (DHL, FedEx, UPS, Royal Mail) | Official but need account and per-carrier terms; several are SUSPENDED for Iran in the availability register | | OBSERVED (register), UNKNOWN (API terms) |

Recommendation: keep manual events as primary. If external tracking is wanted, start with 17TRACK's free quota, verify AWB support on a real cargo number, and map results into `externalEventId` events marked as external. Add a sanctions check on the vendor contract (STAGE-0 Q9).

Sources: https://api.17track.net/en/doc?version=v2.2 , https://www.aftership.com/docs/tracking/quickstart/api-quick-start , https://parcelsapp.com/developers/pricing (accessed 2026-10-29).

## 7. Email, SMS, push (OBSERVED in repo)

Already modelled in apps/api/src/modules/notifications/vendor-schemas.ts and channels.ts: SMS Kavenegar, SMS.ir (for +98 only), Sinch, Infobip; push Expo, Pushy; email Brevo SMTP. Local email goes to Mailpit via `SMTP_URL`. No vendor contract exists (STAGE-0 A5, section E). Not researched further.

## 8. Recommended order

1. Duffel live search for ordinary corridors, after written acceptance and a live token (no code change).
2. Amadeus Enterprise decision as a business step; keep the placeholder.
3. Hotels: apply to Expedia Rapid first (clearest onboarding), then Hotelbeds; only after counsel on Iran exposure.
4. Rail, bus, CIP, insurance: stay staff-fulfilled with flags off.
5. Cargo: manual primary; pilot 17TRACK.

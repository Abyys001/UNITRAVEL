# Content inventory: UniTravel-Content.docx

Source: `UniTravel-Content.docx` (Persian, read in full; it ends at the five-star hotel row of §7-12). Brief of 29 Oct 2026 (§3, §23). Spec for the menu and live data: `docs/CONTENT-MENU-LIVE-DATA.md` (owner decisions O1 to O15). System: ADR-0017.

Evidence labels: **DOCUMENTED** = in the source file, **UNKNOWN** = not supplied or not verified, **INFERRED** = reasoned. Seeded entries are never PUBLISHED (see `packages/db/seed-content/`).

Columns: Dest = destination; Verify = claim to check (ids in `CLAIMS-TO-VERIFY.md`); App = shown in Flutter; Interactive = needs an interactive component; CMS = managed in the CMS; CTA = call to action.

## A. Menu (source §1) and the 14 services

All 14 items are DOCUMENTED. Pages and flags are those of STAGE-16.

| Item | Audience | Purpose | Dest | Verify | App | Interactive | CMS | CTA |
|---|---|---|---|---|---|---|---|---|
| ✈️ پرواز | all | search and request | service page `/flights` + guide entries | C1, C13 | yes | search form, results | guide text only | Search |
| 🏨 هتل | all | listings or request | service page `/hotels` (flag off, O8) | C20 to C24 | yes (browser link) | request form | guide text only | Request a quote |
| 🚆 قطار | all | listings or request | `/trains` (flag off, O8) | no source text | yes | request form | no | Request |
| 🚌 اتوبوس | all | listings or request | `/buses` (flag off, O8) | no source text | yes | request form | no | Request |
| 🏡 ویلا و اقامتگاه | all | listings or request | `/stays` (flag off, O8) | C23 | yes | request form | partly (types article) | Request |
| 🛂 ویزا | international travellers | service request | `/visa` (flag off, O6) | C7 | yes | request form, upload | guide text only | Start a request |
| 🌍 تورهای مسافرتی | leisure | call-back | `/tours` (flag off, O10) | no source text | yes | call-back form | no | Request a call |
| 🛋️ خدمات CIP فرودگاهی | travellers at IKA | request | `/cip` (flag off, O9) | no source text | yes | request form | no | Request |
| 📦 ارسال بار و کارگو | senders | cargo requests | `/cargo` (live) | no source text | yes | form, tracking | no | Get a quote |
| 🛡️ بیمه مسافرتی | flight buyers | request | `/insurance` (flag off, O7) | C8 | yes | request form | guide text only | Request |
| 💳 سفر کارت | all | future product | none (O14, not built) | UNKNOWN | no | no | no | none |
| ⭐ باشگاه مشتریان | members | club | `/club` (flag `loyalty.enabled`) | no source text | yes | member view | no | Sign in |
| 📋 پیگیری خرید | customers | tracking | `/track` | no source text | yes | lookup | no | Track |
| 💬 پشتیبانی | customers | help | `/support` | C9, C10 | yes | form | contact values from settings | Contact |

## B. Flight page (source §2)

| Source | Subject | Audience | Purpose | Dest | Verify | App | Interactive | CMS | CTA |
|---|---|---|---|---|---|---|---|---|---|
| §2-1 | Table of contents of the flight page | visitors | in-page navigation | service page (generated from headings) | no | no | anchor list | derived | none |
| §2-2 | Buying steps | buyers | how to buy | guide `flight-booking-guide` + FAQ | C1, C12 | yes | search form | yes | Search flights |
| §2-3 | Benefits intro ("cheapest and most reputable") | buyers | trust | landing benefits + article `flight-benefits-unitravel` | C2 | no | no | yes | none |
| §2-3 | Instalment purchase | buyers | payment option | landing + dedicated article + FAQ + flight page | C3 (O2) | no | no | yes (unpublished) | Ask support |
| §2-3 | Cheap domestic and international tickets | buyers | value | landing, flight page | C4, C13 (O1, O4) | no | search form | yes | Search |
| §2-3 | Credit payment | buyers | payment option | flight page, FAQ | C3 (O2, O3) | no | no | yes (unpublished) | none |
| §2-3 | Online refund | buyers | after-sales | flight page, FAQ, help | C5 (O5) | yes | request button | yes | Request a refund |
| §2-3 | Visa with the ticket | international travellers | cross-sell | flight page, visa page | C7 (O6) | yes | link | yes | Start a visa request |
| §2-3 | Price-change alerts | buyers | feature | flight page | C6 (O4) | no | alert toggle (not built) | yes (unpublished) | none |
| §2-3 | Flight plus insurance | buyers | cross-sell | flight page, insurance page | C8 (O7) | yes | checkbox (not built) | yes (unpublished) | Request insurance |
| §2-3 | 24-hour support and phone number | customers | support | support page, landing | C9, C10 (O13, O15) | yes | no | settings, not CMS text | Call or write |
| §2-4 | Ticket types (heading only, body not supplied) | buyers | education | guide `flight-booking-guide` (types table from §3-6 and §4) | UNKNOWN: body missing | no | no | yes | none |
| §2-5 | Best time to buy | planners | SEO article | article `best-time-to-buy-cheap-flights` | C11 | no | no | yes | Search flights |

## C. Flight rules (source §3)

| Source | Subject | Audience | Purpose | Dest | Verify | App | Interactive | CMS | CTA |
|---|---|---|---|---|---|---|---|---|---|
| §3-1 | Rules summary | travellers | overview | `/travel-rules` + guide `flight-rules-summary` | C11 to C15 | yes | checklist | yes | none |
| §3-2 | Check-in and boarding pass | travellers | preparation | guide `airport-checkin-and-documents` | C14 | yes | checklist | yes | none |
| §3-3 | ID, passport (6 months), transit visa, no name change | travellers | compliance | same guide, FAQ | C15, C16 | yes | checklist | yes | Visa help |
| §3-4 | Baggage: carry-on, liquids, checked, Xbag, fragile, stroller, Lost & Found | travellers | rules | guide `baggage-guide`, glossary | C17, C18 | yes | none | yes | none |
| §3-5 | Infants, children, pregnancy, illness, pets | families, special needs | rules | guide `special-passengers-guide` | C19 | yes | none | yes | Contact support |
| §3-6 | Changes, delays, cancellation, charter | travellers | rights | guide `flight-changes-delays-cancellations`, FAQ | C5, C20 | yes | none | yes | Track, support |
| §3-7 | Safety on board | travellers | safety | guide `flight-rules-summary` | no | yes | none | yes | none |

## D. Terms and classes (source §4 to §6)

| Source | Subject | Audience | Purpose | Dest | Verify | App | Interactive | CMS | CTA |
|---|---|---|---|---|---|---|---|---|---|
| §4 | 21 airport and flight terms (one has no explanation in the source: Booking) | all | glossary | `/glossary` (structured `glossary_terms`) | carry-on figures only; "Booking" explanation UNKNOWN | yes | search, category filter | yes (glossary) | none |
| §5 | 7 baggage terms | travellers | glossary | `/glossary`, baggage guide | C17 | yes | same | yes | none |
| §6 | Economy, Business, First | buyers | education | article `flight-classes-explained` + glossary | none (add "varies by airline") | yes | none | yes | Search flights |

## E. Hotel page (source §7)

| Source | Subject | Audience | Purpose | Dest | Verify | App | Interactive | CMS | CTA |
|---|---|---|---|---|---|---|---|---|---|
| §7-1 | Hotel page contents | visitors | navigation | service page (generated) | no | no | anchors | derived | none |
| §7-2 | Instalment hotel booking | buyers | payment option | hotel page, FAQ | C3 | no | no | yes (unpublished) | Ask support |
| §7-3 | Online booking, instant voucher | buyers | process | guide `hotel-booking-guide` | C21, C22 | yes | search/request | yes | Request a quote |
| §7-4 | Why UniTravel: support, cities, villas | buyers | trust | landing, hotel page | C9, C23 | no | no | yes | none |
| §7-5 | Variety of hotels and apartments, real photos | buyers | trust | article `hotel-types-and-accommodation` | C24 | no | gallery (later) | yes | none |
| §7-6 | Transparent live prices | buyers | trust | hotel page | C22 (ADR-0004, O8) | no | no | yes (unpublished) | none |
| §7-7 | 24/7 support | customers | support | support page | C9, C10 | yes | no | settings | Contact |
| §7-8 | Cheap hotels and discounts | buyers | tips | article `hotel-price-factors-and-saving-tips` | C25 | no | none | yes | none |
| §7-9 | Step by step booking | buyers | process | guide `hotel-booking-guide` | C21 | yes | none | yes | Request |
| §7-10 | Price factors | buyers | education | article `hotel-price-factors-and-saving-tips` | none | no | none | yes | none |
| §7-11 | Hotel and lodging types (5) | buyers | education, SEO | article `hotel-types-and-accommodation`, glossary | C23 | no | none | yes | none |
| §7-12 | Stars 1 to 5 | buyers | education, SEO | article `hotel-stars-and-service-levels`, glossary | C26 | no | none | yes | none |

## F. Listed in the contents (§7-1) but with no body in the source file

These are **UNKNOWN**. No text was invented; the client must supply them, then they enter through the CMS (`CLASSIFICATION.md`).

| Missing section | Planned destination | Why it matters |
|---|---|---|
| Room types (انواع اتاق‌های هتل) | glossary `ROOM`, hotel article | category exists in `GlossaryCategory`, no terms seeded |
| Meal plans (برنامه‌های غذایی، Meal Plans) | glossary `MEAL`, hotel article | same |
| Hotel check-in terminology (اصطلاحات پذیرش هتل) | glossary `HOTEL` | needed for the hotel guide |
| Important points before booking a hotel (نکات مهم قبل از رزرو هتل) | article | requested by brief §24.4 |
| Flight ticket types (§2-4 body) | guide | only the heading exists |

## G. Brief §3 areas not in the source file as text

Brief items 5 (visa), 8 (price alerts), 9 (insurance), 17 (instalment hotels) appear only as benefit paragraphs above; the service pages for visa, insurance, tours, CIP, cargo and the travel card need business-approved text and are covered by owner decisions O6 to O15, not by this document.

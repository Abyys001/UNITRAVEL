# Stage 17 record: liquid glass, responsive pass, content system (Phase J)

Source: owner brief of 29 Oct 2026 + `UniTravel-Content.docx`. ADR-0017 (content system). Design note in `docs/design/DESIGN.md` (2026-10-29).

## What changed
- **Liquid glass (DOCUMENTED/OBSERVED):** tokens `glass` in `packages/ui/tokens/tokens.json` → CSS vars + Dart; web utilities `liquid`, `liquid-dark`, `glass` (customer site only; console unchanged); header, nav, menus, cards, popovers, dialogs, sheets. Fallbacks: no backdrop-filter, reduced transparency, forced colours; blur 14 px under 640 px. Flutter `GlassPanel`, `GlassBackdrop`, glass bottom bar and `AppCard`.
- **Responsive:** 14 routes checked at 360/768/1280, no horizontal scroll; Persian mobile menu checked by screenshot. Flutter `PageBody` widens on tablets.
- **Flutter parity (OBSERVED):** native service explorer (14 items, availability from `/v1/site`; Travel Card always coming soon), request forms per type (idempotent POST, acknowledgements), request detail with quote/accept/cancel/messages, purchase tracking (signed-in list + public lookup with proof of work, no pair-match leak), club view (no sign-up, no cash value), support (only owner-set contacts). Bottom bar Cargo tab became Services; Cargo moved to `/cargo`. 32 widget tests in `test/services_screens_test.dart`; `flutter build web --release` passes. Screenshots not taken.
- **Content system (ADR-0017):** migration 0012 (`cms_entries`, `cms_revisions` insert-only, `cms_redirects`, `glossary_terms`, `cms.read/write/publish`); API `modules/cms`; web `/blog`, `/blog/[slug]`, `/guides/[slug]`, `/glossary`, `sitemap.ts`, `robots.ts`; console `/content`, `/content/glossary`; Flutter Account › Help › Travel guides, Travel glossary (native, read-only); seed content from the docx (13 Persian entries, 42 glossary terms, none PUBLISHED); `docs/content/{INVENTORY,CLASSIFICATION,CLAIMS-TO-VERIFY}.md`.

## Verification
| Check | Result |
|---|---|
| tsc contracts, db, api, web, console | 0 errors |
| web and console production builds | pass |
| API unit `routes.spec.ts` | 11/11 |
| API e2e `cms.e2e.ts`, `matrix.e2e.ts` | 10/10, 22/22 |
| db unit (seed content spec) | 8/8 |
| web `cms-pages.spec.ts` | 8/8 against a mock API only; not against the real API (BLOCKED: no published seed entry, DB access refused in session) |
| console `content.spec.ts` | written, not run |
| Flutter `analyze` | no issues |
| Flutter tests | 24 golden failures; the same 24 fail with these changes stashed (font/renderer difference), so not re-baselined here |

## Open
- Source docx has no text under room types, meal plans, check-in terms and "before booking" (UNKNOWN; client to supply). Ticket-type section is a heading only.
- Every seeded entry needs owner review of `claimsToVerify` before publishing (`CLAIMS-TO-VERIFY.md`).
- LEGAL and PAGE kinds have no web routes yet; existing terms/privacy/FAQ/rules pages unchanged.
- Visual baselines (web, console) and Flutter goldens need re-baselining on the usual machine.
- Console content e2e and web specs against the real API still to run.
- Not started (no provider or counsel input): hotel/train/bus/stay provider integrations, travel card, installment page, destination pages, CIP/insurance content, tours inventory, Flutter hotel/train/bus/stay provider search (their request forms exist).

## Provider research (29 Oct 2026)
`docs/integrations/PROVIDERS.md`, `CONFIGURATION.md`. Only Duffel is a usable flight source today (search/price/seats built; order and cancel not built, written acceptance on Iran-connected itineraries BLOCKED on STAGE-0 A2 and counsel). Amadeus Enterprise is a contract decision. No documented rail, bus or IKA CIP API (UNKNOWN; scraping forbidden by rule 2). Hotels: Expedia Rapid then Hotelbeds after counsel. Cargo tracking: 17TRACK pilot beside manual. Cancelling or ordering via Duffel needs an ADR before code.

## Web content pass (Phase J, part 2)
- LEGAL and PAGE routes `/legal/[slug]`, `/info/[slug]` (shared renderer; drafts 404; footer links appear only for published entries); destinations `/destinations`, `/destinations/[slug]` (GUIDE with category `destination`, `/guides/<slug>` redirects there, CTAs to flights, track, support).
- Travel card: flag `services.card.enabled` (default off, migration 0013 inserts the row, seed meta added), menu key `card`, `/card` is a Coming Soon page when on and "not available" when off; no financial claims. The home explorer never opens it.
- Home: Service explorer (12 services, five interaction patterns, flag-aware, off = "Coming soon" with no link), Benefits (account features only), Featured destinations (hidden when none), Support band (links; phone/email only when real), existing FAQ band kept.
- Seed content: PAGE `installments`, LEGAL `refund-and-cancellation`, `baggage-terms` (IN_REVIEW, claims C3/C5/C17/C18/C20 listed; legal ones marked draft for counsel).
- Checks (OBSERVED): web tsc 0, `next build` ok, api routes.spec 11/11, `services.e2e.ts` 9/9 (menu now has `card`), db seed spec 4/4, new `web-content.spec.ts` 5/5 (incl. axe en/fa, no overflow at 390/1280), `cms-pages` 7/7 and `content-pages` 10/10 against the real API. `site-menu.spec.ts`: 3/5; the two failures are customer sign-in steps ("no OTP", the local email sink is not delivering), not caused by this change.
- Open: existing home trust item `trust4` says "Support in your language, day and night" (unverified claim C9); left unchanged, owner to decide. Server pages read the API through a 60 s cache, so a newly published entry can take a minute to appear.

## Owner decision 29 Oct 2026: every service live except the Travel card
Migration `0014_services_on.sql` and `DEFAULT_FLAGS` switch on hotels, stays, trains, buses, visa, tours, CIP, insurance and the customer club; the Travel card keeps its Coming Soon page. Hotels, stays, trains, buses, visa, tours, CIP and insurance are **request forms** (sign-in required, staff quote, no listings, no fake inventory: ADR-0015 still holds). Counsel items O6 (visa), O7 (insurance), O9 (CIP), O10 (tours) are still UNKNOWN and listed in `docs/content/CLAIMS-TO-VERIFY.md`; the owner has accepted the risk by switching them on. Tests updated: `services.e2e.ts` (menu defaults), web `content-pages` (12 guide sections), `web-content` (explorer). Verified: API e2e services, club, matrix 37/37; web content specs 21/21; home explorer shows "Coming soon" only for the Travel card (the App Store line in the app promo is about the mobile app, left as is).
Not run: console `content.spec.ts` (sign-in OTP never arrives: local email sink issue) and two `site-menu` sign-in steps, same cause. `live-data.spec.ts` fails with or without these changes.

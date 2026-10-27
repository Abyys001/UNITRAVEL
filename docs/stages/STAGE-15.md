# Stage 15 record: Phase H, content pages (FAQ, travel rules, flight-buying guide)

Source: `docs/CONTENT-MENU-LIVE-DATA.md` §3 (owner message of 27 Oct 2026). No ADR (content). Owner decisions applied as proposed defaults: O1 (international only; "داخلی" dropped), O2 (no instalments; pay at ticketing), O3–O5 (reworded guide headings), O6/O7 (visa and insurance items hidden behind their flags), O15 (no 24-hour claim).

## What changed (DOCUMENTED)
- Content (`packages/i18n/src/content/`): `types.ts` (`Item`, `Block` = paragraph, ordered list, bullet list or link, each with an optional `flag`; `visibleItems(items, flags)`), `faq.ts` (5), `travel-rules.ts` (6), `flight-guide.ts` (12), each `{ en, fa }` with identical ids; exported from `packages/i18n/src/index.ts`. Guide item 1 reuses the FAQ "how to buy" blocks by reference. Gated by flags: guide visa item (`services.visa.enabled`), insurance item (`services.insurance.enabled`), the online-card sentence (`payments.online.enabled`). Guide item 10 shows «پشتیبانی به فارسی و انگلیسی» / "Support in Persian and English" with no hours.
- UI keys (en, fa): `nav.faq`, `nav.travelRules`, `nav.flightGuide`, `home.faqTitle`, `home.faqAll`, `content.generalNotice`, page titles, `content.contents`.
- Web: `components/content-blocks.tsx` (shared blocks, native `<details>` accordion, page frame, FAQPage JSON-LD with the CSP nonce); pages `/[locale]/faq`, `/[locale]/travel-rules`, `/[locale]/flights/guide` (contents list with anchors); home FAQ band (5 questions, link to `/faq`); footer Help column gains the three links.
- Flutter: Account › Help (`HelpLinks`, `helpPageUri`) opens `/<locale>/faq`, `/travel-rules`, `/flights/guide` with `LaunchMode.externalApplication`, like the pay page (the spec said in-app browser; the existing pattern wins); ARB keys `helpTitle`, `helpFaq`, `helpTravelRules`, `helpFlightGuide`, also added to `tool/gen_arb.py`.
- Tests: `packages/i18n/src/content.spec.ts`; `apps/web/e2e/content-pages.spec.ts`; three screens added to `apps/web/e2e/visual.spec.ts`; `apps/mobile/test/help_links_test.dart`.

## Verification (OBSERVED, 27 Oct 2026, local)
| Check | Result |
|---|---|
| i18n unit | 12/12 (3 files) incl. the content spec |
| Web typecheck | 0 errors |
| `content-pages.spec.ts` | 16/16 (desktop and mobile, en and fa): headings, details toggle by click and Enter, FAQPage JSON-LD with 5 questions, notice, `dir`, axe with no serious or critical violations, home band and footer links |
| Web visual suite (sign-in excluded) | 84/84. Every page with a footer was re-baselined (new Help links, new home band); new baselines for the three pages in en and fa, desktop and mobile |
| Flutter | analyze clean; `flutter test` 106 passed |

## Open
- Sign-in visual baselines still need regenerating once the test sign-in restore (ADR-0014) is final.
- Copy written by the implementer, hidden today, to be replaced by the owner's: guide visa link text «خدمات ویزا» / "Visa services", the online-card sentence, the travel-rules link text to the search and request form (it points at `/` because a request needs a search). Insurance and support items have headings only.
- The pages read no flags yet (an empty set): flagged items stay hidden until `GET /v1/site` (Phase I) feeds them.
- `apps/mobile/tool/gen_arb.py` does not match the committed ARB files (it predates later keys); running it would overwrite them. Not fixed here.

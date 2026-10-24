# Stage 12 record: Phase F, design and UX

Source: `docs/ADDITIONAL-REQUIREMENTS.md` (Phase F, owner decision 3: audit and improve, no new direction), `docs/design/DESIGN.md`, kit UI policy. Audit: `docs/design/AUDIT-2026-10.md`.

## What changed (DOCUMENTED)
- Token source: `packages/ui/tokens/tokens.json` -> `packages/ui/scripts/gen-tokens.mjs` -> `packages/ui/src/tokens.css` (imported by `styles.css`; console dark block removed from `globals.css`) and `apps/mobile/lib/ui/tokens.g.dart` (`Brand` in `theme.dart` aliases `BrandTokens`). `pnpm --filter @unitravel/ui test` fails when generated files are stale. No new dependency. Orange-700 darkened to `#a84d00` for AA.
- Shared patterns in `packages/ui/src/product/`: `timeline`, `stepper`, `document-card`, `verification-badge`, `payment-state`, `states` (loading, empty, error), `ledger` (console Tag, Panel, PageHead, LedgerField, Bidi); `components/native-select.tsx` plus its rule in `styles.css`. Flutter: `lib/ui/patterns.dart` (`AppTimeline`, `RequestStepper`, `DocumentCard`, `VerificationBadge`, `PaymentStateBanner`; `verificationLook` moved here).
- Duplicates removed: the web `StatusTimeline` and `TrackingTimeline` are adapters over `Timeline`; Flutter tracking timeline and kit `TimelineList` use `AppTimeline`; console `ui.tsx` keeps only `CommandButton`, `useAct`, `ErrorLine`, thin `Loading` / `Empty` and re-exports (needs the console API client); 60 native `<select>` replaced by `NativeSelect` (web 14, console 46).
- Used on screens: stepper, document cards, states on web request detail; payment states on pay and return pages and the Flutter invoice; states on requests, shipments, billing, invoice, itinerary, search, inbox, cargo detail.
- Strings (en/fa): `requests.progress.*`, `requests.loadFailed`, `requests.noDocuments` (packages/i18n); ARB `progress*`, `billingPaidBanner` (`tool/gen_arb.py`).
- Accessibility fixes found by axe: see audit findings 1 to 5.
- Tests added: web `e2e/visual.spec.ts` (76) and `visual-capture.spec.ts`; console `e2e/visual.spec.ts` (72) and `visual-capture.spec.ts`; shared replay helper `apps/web/e2e/support/cassette.ts`; seed `apps/api/test/visual-seed.ts`; Flutter `test/golden/golden_test.dart` (24 goldens). `@axe-core/playwright` 4.10.2 added to the console (same pin as the web; needed for its axe checks).

## How the snapshots stay deterministic
Data: recorded once from the seeded local stack into `e2e/visual/cassette*.json` (`CAPTURE=1 npx playwright test visual-capture --project=desktop`), replayed through `page.route`, so no sign-in, no OTP and no cooldown collisions in the snapshot specs. Time frozen at capture time, UTC, `reducedMotion`, `animations: disabled`, video masked, any unrecorded API call fails the test. Update on purpose: `npx playwright test visual --update-snapshots`; Flutter: `flutter test test/golden --update-goldens`. The console helper's `shot()` still writes to `test-results/shots` unless `UPDATE_SCREENS=1`.

## Final regression (OBSERVED, 2026-10-24)
| Check | Result |
|---|---|
| Typecheck (turbo, 14 tasks: contracts, domain, engine, db, i18n, ui, api, web, console) | 0 errors |
| Unit | domain 67, i18n 3, engine 7, api 43, ui tokens-stale check 1; all pass (`turbo run test --concurrency=1`; parallel runs collide on `node_modules/.vitest-cache`, an environment race) |
| API e2e, full run | 72 tests: 63 passed, 3 skipped, 6 failed (staff OTP rate-limit flakes: stage1 Developer Panel routes, stage2 x3, stage9 replay, stage10 PAY_ON_TICKETING; matrix `admin` also listed). Re-run alone: stage1 8/8, matrix 22/22, stage2 4/4, stage9 2/2, stage10 4/4 |
| Web Playwright, full | 106 passed (30 existing + 76 visual with axe) |
| Console Playwright, full | 87 passed, 2 skipped (the opt-in capture specs; deck-shots is also opt-in) incl. 72 visual with axe |
| Flutter | `flutter analyze` no issues; `flutter test` 103 passed (79 earlier + 24 goldens). Needs `NO_PROXY=127.0.0.1,localhost` here (the shell proxy breaks the test websocket) |
| Flutter web | `flutter build web --release --no-web-resources-cdn` built; served by `scripts/svc.sh restart mobile` on 4300 (HTTP 200); `apps/mobile/e2e/smoke.mjs` 14/14 OBSERVED (24 Oct 2026) after the itinerary steps were rewritten for ADR-0004 (wait for "Request this itinerary" instead of "Total price"; customer price check and price-change acceptance removed); all steps are now hard failures |

## Open items
- Console fa translation is partial (audit 14); dark-mode and Flutter admin screens have no snapshots (audit 19); real screen reader pass is UNKNOWN (audit 20).
- Flutter goldens with times depend on the machine time zone (audit 18). Snapshots are about 22 MB for the web; if the repository size matters, move them to Git LFS or drop the phone-width fa duplicates.
- Smoke steps 3 (itinerary), 4 (requests list) and the English pass should be rewritten for ADR-0004 (no price before a quote).

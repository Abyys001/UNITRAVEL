# Control deck (console UI update)

Design rules: `docs/design/DESIGN.md` "Control deck". Screenshots here are review captures, not the tracked reference set in `docs/screens/console/`.

## Phase 1 (dashboard, shell, dark theme)
`home-*`, `palette-*`, `more-sheet-*`, `rail-*`, `dev-health-dark-1440.png`.

## Phase 2 (queues, case pages, list pages)
Screens: `queues-*`, `request-*`, `request-customer-*` (phone tab), `verification-*`, `compliance-*`, each as light/dark at 1440 and 390.

Shared building blocks (`apps/console/src/components/case.tsx`, on top of `bento.tsx`):
- `SlaChip` / `SlaRing`: countdown chip, text always shown ("in 1 h 12 m", "breached 3 h ago"), one 30 s clock for the whole page. Tone: breached = danger, under 25 % of the window or under 30 min = warn. Ring = share of the submitted-to-due window left.
- `StateChip`: workflow status as a `StatusChip`; the visible text is the status itself.
- `TruthTally`: known / not included / UNKNOWN counts for the latest quote. UNKNOWN is the server's `unknownFields` (the same facts that block sending), shown in danger with "UNKNOWN blocks sending the quote", never merged into "known".
- `ActionBar`: sticky strip. `top` holds the server-computed commands on request and cargo pages (the old Actions panel, `data-testid="actions"`, reasons still shown); `bottom` docks a decision or publish button above the phone tab bar.
- `CaseTabs` + `paneClass`: columns become tabs below `lg` (request: Case / Customer / Records; cargo: Case / People / Records; verification: Scan / Fields / Decision; compliance: Evidence / Decision / History). From `lg` all columns show side by side.
- `Timeline`: day-grouped activity trail (request and cargo).

What changed per screen:
- **Queues**: `StateChip` + `SlaChip` per row, sticky filter bar (collapsible "Filters" on phones), saved views as chips in `localStorage` (inline name field instead of `window.prompt`, remove button), skeleton / empty (with "Clear filters") / error-with-retry states, phone rows are cards. j/k/Enter/c/n unchanged. No bulk select: there is no authorised bulk endpoint, and none was added.
- **Request**: bento header (state, SLA, owner, what we know), sticky action bar, timeline, tabs on phones with Call kept in the header, price re-check result as a toast.
- **Quote builder**: summary tiles (options, UNKNOWN facts, validity, lowest total), footer is sticky above the phone tab bar.
- **Cargo**: header tiles (state, goods screening, chargeable weight, delivery estimate), same bar, tabs and timeline. The API has no owner or SLA for cargo detail, so none is shown.
- **Customer, verification, compliance case**: bento header, tabs on phones, bottom-docked decision button. Verification flags an expired document.
- **Compliance index, lists, policies, verifications, invoices, search, account**: summary tiles where useful, state chips, phone cards for compliance, verifications and invoices, wide tables scroll inside their box, skeleton / empty / error states.
- **Developer panel** (health, audit, users, config): same primitives and states; behaviour unchanged. The audit "hash chain intact" result is a toast, a broken chain stays an inline alert.

Copy added to `lib/i18n.ts` (en and fa). Older page labels are still English only, as in Phase 1.

Capturing: `DECK_SHOTS=1 npx playwright test deck-shots --project=desktop` (opt-in spec `e2e/deck-shots.spec.ts`, signs in as the owner, seeds one request). Regular suite screenshots now go to `apps/console/test-results/shots`; set `UPDATE_SCREENS=1` to rewrite `docs/screens/console/`.

Not verified: Persian (RTL) layouts were not screenshotted; the UNKNOWN count shows 0 in the captures because the seeded supplier offer states every fact (the non-zero state is covered by the quote builder test, not by a screenshot).

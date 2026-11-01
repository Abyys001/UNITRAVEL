# ADR-0023: Customer typefaces: Figtree for Latin text, Alexandria for Persian display

- Status: accepted (owner request, 1 Nov 2026: "determine the best font ... select a few aesthetically pleasing fonts and incorporate them")
- Scope: customer web (`apps/web`), Flutter mobile (`apps/mobile`) and the mobile landing shell (`infra/mobile-shell`). The console keeps ADR-0011. PDFs and email are unchanged.
- Evidence: side-by-side renders of real UniTravel copy, and font-table checks of glyph coverage and `tnum` (OBSERVED, 1 Nov 2026). Aesthetic ranking is a design judgement (INFERRED).

## Context
DESIGN.md set Montserrat for all Latin text and Vazirmatn for all Persian text. Booklet ch. 28 asks for self-hosted fonts: "Vazirmatn for Persian, an open Latin face".
- Montserrat is a wide geometric display face. ADR-0011 already removed it from console text for that reason; customer web and mobile still set paragraphs, forms and prices in it.
- Persian headings use the body face, so Persian-first customers get hierarchy from weight alone. Montserrat headings have more presence than their Vazirmatn equivalents.

## Decision
| Role | Latin | Persian |
|---|---|---|
| Display | Montserrat 800 (brand, unchanged) | **Alexandria 700** (new) |
| Text and UI | **Figtree** (new) | Vazirmatn (booklet, unchanged) |
| Codes | JetBrains Mono (unchanged) | n/a |

The logo keeps Montserrat and Vazirmatn. All faces are OFL and self-hosted.

Candidates rejected:
- Latin text: Inter (already the console's data face; the customer site is meant to feel warmer), Manrope and DM Sans (awkward tabular figures), Plus Jakarta Sans (tight word spacing at text size), Hanken Grotesk (no `tnum`).
- Persian display: Estedad (too close to Vazirmatn to add hierarchy), Noto Kufi Arabic (mechanical at headline size), Lalezar (too playful for a trust-critical product), IBM Plex Sans Arabic (lighter presence), Readex Pro (no پ چ ژ گ).

## Consequences
- Figtree's single web file is 28 KB and all weights are in it. Alexandria's Arabic subset is 62 KB and is not preloaded, so English pages do not fetch it.
- Mobile keeps only Montserrat ExtraBold, removing four unused 363 KB files.
- This narrows the owner's 23 Oct 2026 instruction to keep the brand's fonts: Montserrat and Vazirmatn stay, for brand and display use and for Persian text respectively.
- Alexandria display type deviates from a literal reading of the booklet's "Vazirmatn for Persian"; Persian body text still follows it.
- Hierarchy rule: page and section titles use `font-display`; card titles and body text use the text face. The rule is the same in both languages.
- Vazirmatn has no arrows (→ ←), so the customer site's Persian stack falls back to Figtree for them. Figtree has no Arabic letters, so Persian text is unaffected.
- JetBrains Mono is no longer preloaded on the customer site; it loads when a page uses it.
- Mobile goldens were regenerated; all 24 already failed before this change.
- `apps/web/e2e/visual/cassette.json` predated stages 16-18, and all 88 web visual tests failed on it. It was re-recorded on 1 Nov 2026 and the snapshots regenerated: 88 of 88 passed on a second run without updating. The new baselines also capture the other uncommitted work in the tree on that date, so they were not a font-only diff.
- The dimmed "Coming soon" service cards failed AA contrast (`opacity-80`, an axe failure on the home page). The opacity was removed; the written label still marks those cards.
- Sources and licences are in the engineering kit's `fonts/`.

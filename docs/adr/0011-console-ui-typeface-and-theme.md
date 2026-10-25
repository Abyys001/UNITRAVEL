# ADR-0011: Console UI typeface, type scale and theme (Control deck v2)

- Status: accepted (owner request, 25 Oct 2026 — "complete dashboard UI/UX audit and premium redesign")
- Scope: Admin and Developer panels (`apps/console`). Customer web and Flutter mobile are unchanged.
- Evidence: `docs/design/UI-AUDIT-2026-10-25.md` (OBSERVED measurements from a headless browser on the local stack).

## Context
DESIGN.md (2026-10-23) sets Montserrat for Latin UI text and JetBrains Mono for references, and the console set
`html { font-size: 13px }`. The audit measured the result: 99% of text at 9.5–13 px, 34% of the queue page in JetBrains
Mono (dates, SLA timers, counts, KPI figures), and Montserrat — a wide geometric display face — carrying 13 px table text.
The owner reported the font as "missing or incorrectly loaded"; the files load correctly, the face and sizes were the problem.
The dark theme painted every card in saturated royal (`#082f6b`), and the orange focus ring measured 2.4:1 on white
(below WCAG 1.4.11's 3:1).

## Decision
1. **Inter** (OFL, self-hosted, already in the repository's first build) sets console UI and data text, with tabular
   figures. **Montserrat stays the brand face** for page titles, the greeting and the logo, so the brand is kept.
   Vazirmatn for Persian; JetBrains Mono only for references and codes (`.ref`).
2. Root size is the browser default (16 px). Console sizes come from a token scale — 11 / 12 / 13 / 14 / 15 / 18 / 22 / 28
   px (`text-2xs` … `text-display`) — with no literal pixel sizes in components. Compact density tightens spacing and
   row height on fine pointers only.
3. Console colours are their own token sets in `tokens.json` (`console` light, `dark`), emitted under `html[data-surface]`
   and `html[data-theme="dark"]`. Light: cool neutral canvas, white surfaces, navy rail, royal for interaction, orange kept
   for the brand indicator and attention. Dark: desaturated ink navy instead of royal cards. Focus ring is royal (5.7:1)
   in light and blue-400 (6.8:1) in dark. `scripts/tokens.test.mjs` asserts AA contrast for both sets.
4. The console frame is a fixed-height app frame with `<main>` as the only scroller; z-order comes from named layers
   (`--z-sticky` … `--z-tooltip`).

## Consequences
- DESIGN.md "Type" and the console column of the tokens table are superseded for the console by this ADR.
- No new runtime dependency (charts are SVG on tokens; Inter is a local font file).
- The customer site keeps Montserrat/`:root` tokens; shared `packages/ui` changes are limited to the base-layer focus rule,
  the console status `Tag`, and tailwind-merge knowing the type scale.

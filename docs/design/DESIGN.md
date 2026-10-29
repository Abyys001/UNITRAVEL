# UniTravel — design direction (UI policy §21)

Revised 2026-10-23: the first build used an invented "Cartographer's ledger" look (copper/sand, Fraunces/Inter).
The owner supplied the real brand (`unitravels-co-uk/2026-10-23/`, Design Thief capture of unitravels.co.uk;
kit copy `sources/design-thief/unitravels-co-uk/`) and asked for a major visual upgrade that **keeps the brand's
logo, palette and fonts**. Inspiration references: kit `sources/references/travel-brand-2026/`.

## Product analysis (unchanged)
- **Customers** (Iran, diaspora, students): anxious, high-stakes journeys assembled from fragments; often on
  slow or filtered connections, Persian-first. They need honesty (truth badges), plain status words, and a human
  behind the request. Touch-first on mobile web; the website is the guaranteed channel (ch. 29.3).
- **Admins**: phone-centric case work; one screen per case, commands not fields, keyboard-friendly.
- **Developers/owner**: control room — versioned config, health, audit.

## Direction: "Night flight / سفر شب"
The brand artwork is a deep navy-to-royal night sky, a white-and-orange swoosh around a globe, a curved orange
ribbon separating copy from landmark photography, dashed flight paths ending in a map pin, and round outline icons.
The customer site turns that into a confident, cinematic travel brand; the console stays a calm ledger in the
same colours.

| | Customer web / mobile | Admin Panel | Developer Panel |
|---|---|---|---|
| Personality | Cinematic, warm, trustworthy | Dense, precise, quiet | Technical control room |
| Density | Airy, large type | Compact 13–14 px, tables | Compact, monospace values |
| Navigation | Transparent→navy glass top bar; mobile bottom bar | Navy rail + 3-column case workspace + `j/k/c/n` | Navy rail (cyan accent) + versioned editors |
| Signature | Video hero + orange ribbon, dashed flight path with pin | Orange active indicator, workshop stripe | Cyan active indicator |
| Motion | Hero video, path draw/dash, plane on path, scroll reveals | Focus/hover only | Focus/hover only |

### Surface rule (kit UI policy §7 vs §23)
The brand itself uses glass pills and a navy gradient, so they stay — but **only on dark brand surfaces**: hero,
inner-page header band, footer, sign-in media panel, console rail. Content (forms, results, quotes, tables) always
sits on white cards with hairline borders and a soft navy shadow. No gradients on content, no blobs.
**Update 2026-10-24:** dark mode exists on the console only (Admin and Developer panels, see "Control deck"). Customer web
and mobile stay light: their brand surfaces are already dark and the booking flow is a trust moment tuned on white.
**Update 2026-10-29 (owner request, liquid glass):** customer web and Flutter now use liquid glass on content too: header,
menus, cards, popovers, dialogs, sheets, mobile bottom bar. Tokens in `tokens.json` `glass` (blur, saturation, fill, edge);
web utilities `liquid`, `liquid-dark`, `glass`, scoped to the customer site (`html:not([data-surface])`, console unchanged);
Flutter `GlassPanel` / `GlassBackdrop` (`widgets.dart`). Text stays on >= 0.6 white or >= 0.78 navy panes (AA). Fallbacks:
no backdrop-filter, `prefers-reduced-transparency`, forced colours (web) and high contrast (Flutter) give opaque panes;
blur drops to 14 px under 640 px. Form fields and booking totals stay on solid fields.

## Tokens pipeline (Phase F, 2026-10-24)
One source: `packages/ui/tokens/tokens.json` (palette, status tints, radii, shadows, light and dark semantic variables, Flutter night
surfaces). `node packages/ui/scripts/gen-tokens.mjs` (`pnpm --filter @unitravel/ui tokens`) writes `packages/ui/src/tokens.css`
(`@theme` + `:root` + `[data-theme="dark"]`, imported by `styles.css`) and `apps/mobile/lib/ui/tokens.g.dart` (`BrandTokens`, consumed by
`Brand` in `theme.dart`). Never edit the generated files; `pnpm test` in `packages/ui` fails when they are stale (`--check`). The kit_ui
package stays vendored; the app overrides its colours from `BrandTokens`, so there is no second palette.

## Shared patterns (`packages/ui/src/product/`, Flutter `apps/mobile/lib/ui/patterns.dart`)
| Pattern | Web | Flutter | Rule |
|---|---|---|---|
| Timeline | `Timeline` (request status, cargo tracking) | `AppTimeline` | one flight-path timeline; current stop orange; newest-first lists pass `currentIndex` |
| Request progress | `Stepper` | `RequestStepper` | five customer steps; closed requests show none; state spoken, not colour only |
| Document card | `DocumentCard` | `DocumentCard` | tickets, quotations, passport scans; actions passed in |
| Verification badge | `VerificationBadge` | `VerificationBadge` | state always written out |
| Payment state | `PaymentState` | `PaymentStateBanner` | processing never reads as success; success only when the server says PAID |
| Loading / empty / error | `LoadingState`, `EmptyState`, `ErrorState` | kit `SkeletonBox`, `EmptyState`, `ErrorState` | `role=status` / `role=alert`, retry on errors |
| Select | `NativeSelect` | n/a | native on purpose (OS picker, RTL, selectOption); chevron mirrors, 44 px on coarse pointers |
| Console kit | `product/ledger` (Tag, Panel, PageHead, LedgerField, Bidi) | n/a | `apps/console/src/components/ui.tsx` keeps only API-bound helpers |

Orange-700 text colour is now `#a84d00` (was `#b85500`, 4.36:1 on the warning tint; now 5.1:1 on it and 5.6:1 on white).

## Tokens table (values below are generated from tokens.json; Flutter `apps/mobile/lib/ui/theme.dart`)
| Token | Hex | Use |
|---|---|---|
| navy-950 | `#061f4c` | ink, darkest band, text on orange |
| navy-900 | `#082f6b` | primary buttons, rail |
| navy-800 | `#083575` | gradient mid |
| royal | `#0c67b9` | links, gradient end (5.7:1 on white) |
| blue | `#0d8df2` | illustration, large fills only |
| cyan | `#11b7ff` | LIVE / info accents, icons, dark-surface text — never small text on white (2.3:1) |
| orange | `#ff8617` | primary action fill (navy text, 6.6:1), ribbon, pins, highlights |
| orange-300 | `#ffac50` | highlight text on navy (8.6:1) |
| orange-700 | `#a84d00` | orange text on white (5.1:1 on the warning tint, 5.6:1 on white) |
| cloud | `#f4f8fd` | page background |
| line | `#dbe5f2` | hairlines |
| steel | `#4a5d7a` | secondary text (6.7:1) |
| success / danger | `#16794a` / `#c0362c` | confirmed / risk |

The first build's names (`ink, copper, sand, …`) were swept and removed on 2026-10-23.

- Truth badge tones: LIVE = cyan-tinted outline, CACHED = steel outline, PRICED/CONFIRMED = success solid,
  MANUAL = orange-700 outline, FAKE = danger striped, SEPARATE TICKETS = danger outline, GATEWAY = royal outline.
  Always text, never colour alone.
- Type: **Montserrat** (Latin display 800 / UI 400–700), **Vazirmatn** (Persian display 800 and UI),
  **JetBrains Mono** (references, codes, dev values). All self-hosted via `next/font/local` and Flutter assets
  (no Google Fonts — ch. 28.4); sources in kit `fonts/`.
- Radius 16 px cards and buttons, 12 px controls, 999 px pills; shadows `--shadow-card` / `--shadow-lift`.
- Buttons: `btn-orange` (primary CTA), `btn-glass` (on dark), shadcn `Button` (navy) inside content.
- RTL: logical properties only; numbers, flight numbers and references wrapped in LTR isolates (ch. 29.4).
  Directional art (arrows, plane on path) mirrors in RTL.

## Logo
Vector redraw of the brand mark: `packages/ui/src/brand/logo.tsx` (`LogoMark`, `Logo` variants
mark/horizontal/stacked × onDark/onLight); static `assets/brand/logo/*.svg|png` for favicons, OG and Flutter.
Wordmark: "UNI TRAVEL" Montserrat 800 over "یونی تراول" Vazirmatn. Minimum mark size 24 px.

## Imagery and media
- Hero: muted looping video (WebM/MP4, ≤2.5 MB) under a navy gradient overlay; poster image is the LCP element.
  Paused/poster-only under `prefers-reduced-motion` and Save-Data.
- Destinations: decorative landmark photos captioned with city names only — never prices, availability or
  offers (CLAUDE.md rule 2). Credits: `apps/web/public/media/CREDITS.md`.
- Illustrations (`packages/ui/src/brand/art.tsx`): `Ribbon`, `FlightPath`, `IconBadge`, `GlobeLines`.

## Patterns adapted (not cloned)
- `components/web/ui` (shadcn Base UI primitives) restyled on these tokens.
- Kit `components/web/motion` (reveal, dash/orbit/marquee utilities) adapted into `packages/ui`.
- Airline search-widget hero (search card over media, booking first), editorial destination bento, vertical
  flight-path status timeline, support-desk master/detail console — see the references README synthesis.

## Accessibility
WCAG 2.2 AA: 4.5:1 contrast (table above), visible focus rings (orange 2 px), labels on every input, errors tied to
fields, status changes in `aria-live` regions, 32 px minimum touch targets, no colour-only meaning, all decorative
SVG `aria-hidden`, every animation has a reduced-motion end state, video has no audio and no essential content.

## Control deck (2026-10-24)
Owner-approved upgrade of the console (Admin and Developer panels): bento overview, dark theme, better navigation.
The ledger principles stay (dense type, mono references, hairline rules); the dashboard becomes a deck of tiles.

- **Bento dashboard** (`components/bento.tsx`): 12-column grid >= 1024 px, 6 >= 640 px, 1 on phones. Tile sizes s/m/l/xl/full,
  optional 2 rows. Order on the admin home: "Needs you now" hero (SLA at risk + unassigned, orange border, red when SLA is
  breached), compliance and identity counters, four KPI tiles, queue-health bar, 24 h ticketing deadlines, my cases,
  live activity (SSE), quick actions. Every tile has a skeleton, an empty state and an error state with retry.
- **Honest numbers.** Tiles show only what the API returns. The API has no history, so sparklines and deltas are what this
  browser tab observed (sessionStorage, "since you opened this page"); with fewer than two samples a dashed baseline and
  "trend appears as counts change" is shown. The deadlines sparkline is the real deadline list bucketed per 3 h.
- **Dark theme.** `html[data-theme="dark"]`, user choice light / dark / system in the user menu (`ut-theme` in localStorage),
  applied by an inline nonce script before first paint. Semantic variables: `--surface`, `--surface-raised`,
  `--surface-sunk`, `--ink`, `--ink-muted` (alias `steel`), `--rule`, `--rule-strong`, `--hover`, `--chrome`; pages use
  `bg-surface-raised`, `text-ink`, `text-steel`, `border-rule`, never `bg-white` or hex.
- **Density.** Comfortable (default) or compact (`ut-density`); compact scales `--spacing` and tile padding on fine pointers
  only, so touch targets stay >= 32 px on phones and tablets.
- **Shell.** Collapsible icon rail (`ut-rail`, applied before paint), breadcrumbs, command palette (Cmd/Ctrl+K or `/`: pages,
  actions, go-to resolver), alerts bell fed by queue counts / SSE, user menu (theme, density, language, sign out), phone
  bottom bar + "More" sheet. Language en / fa (`ut-locale`) flips `lang` and `dir`; strings in `lib/i18n.ts`.
- **Motion.** Hover/focus transitions and shimmer only; `prefers-reduced-motion` removes all animation.

### Dark tokens and contrast (WCAG 2.2 AA, re-verified 2026-10-24)
Page `#061f4c` (navy-950), raised cards `#082f6b` (navy-900), sunk fields `#04173a`, hairlines `rgb(255 255 255 / 0.12)`.
Contrast is on page / raised card.

| Token (dark) | Value | Use | Ratio |
|---|---|---|---|
| ink | `#eaf1fb` | body text | 14.1 / 11.3 |
| steel (ink-muted) | `#a9bdd9` | secondary text | 8.4 / 6.7 |
| orange-700 -> orange-300 | `#ffac50` | orange text | 8.6 / 6.9 |
| orange | `#ff8617` | indicator, focus ring, hero border (non-text, >= 3) | 6.6 / 5.3 |
| cyan | `#11b7ff` | dev indicator, info accents | 7.1 / 5.7 |
| royal | `#6cc0ff` | links | 8.1 / 6.5 |
| success / danger | `#4cc38a` / `#ff8a7e` | status text | 7.2 / 7.0 on page, 5.8 / 5.6 on card |
| navy-950 on solid success / danger / orange | | text on solid chips and buttons | 7.2 / 7.0 / 6.6 |
| subtle chips (success / warning / info fg on 15% tint) | `#86e0b2` `#ffb870` `#86d6ff` | status chips | 6.3 / 6.4 / 6.1 |
| danger on danger-subtle | `#ff8a7e` | error banners | 4.6 |

Light-mode ratios are unchanged (table above). Status is always text plus colour, never colour alone.

## Console rebuild: "Clear deck" (2026-10-25)
Owner feedback: the sidebar and the admin panel were cluttered and hard to read; rebuild the console without reducing any
access. Patterns compared (kit `sources/`): shadcn sidebar (grouped, collapsible icon rail), Kiranism starter (flat nav + kbar),
tablecn / Data Table Filters (toolbar + chip filters + pager), Linear-style hub tabs. Adapted: a flat rail with hub tabs, one
list toolbar, chip filters. Not taken: nested accordion groups (they were the clutter), per-column filter popovers.

- **Navigation = destinations, not pages.** The rail is one flat list with no headings (Admin 6, Developer 6). Related pages are
  tabs under the header (`NavItem.tabs`, rendered by `Shell`), and `NavItem.match` claims child routes (a request page belongs
  to Requests). Queue tabs live only on the Requests page, saved views only in its filter bar, "Sessions & second factor" only
  in the user menu and palette. Every item and tab keeps its previous `can(...)` check; a hub's link is its first permitted tab,
  so no permission loses a page. The backend still decides access (CLAUDE.md rule 4).
- **Shell.** Full-height navy rail (brand + panel chip, items 40 px, orange/cyan active bar, collapse at the foot); light
  sticky top bar (breadcrumbs, palette trigger, shortcuts, bell, user menu). Phones: compact top bar, bottom bar of the
  `mobile` items + More sheet (items with their tabs).
- **Type.** `.cap` is now sentence-case 11.5 px semibold sans; uppercase mono is gone from labels and headers. Mono stays for
  references, codes, money and counts (`.num`). Status `Tag`s are rounded pills, sans semibold.
- **Lists.** `components/data-list.tsx`: `Toolbar` (search, `Chips`, controls, live count), `usePaged` + `Pager` (25 rows),
  `ListCard`, `.data-table` (sunk header band, 10 px rows, hover). Long lists (policies, audit, invoices, users) page and group.
- **One number, one place.** A count appears once per screen; dashboards do not repeat the same queue numbers in a summary
  line, a hero, KPI tiles and a bar.

## Control deck v2 (2026-10-25)
Owner-requested redesign after the UI/UX audit (`docs/design/UI-AUDIT-2026-10-25.md`); typeface and theme decisions in
ADR-0011. Supersedes "Type" and the console colours above for the Admin and Developer panels only.

- **Frame.** Fixed-height app frame: navy rail and top bar never scroll; `<main>` is the only page scroller, so nothing slides
  under the header and sticky offsets are relative to `main`. Rail groups (Work / Records / Tools; Operate / Configure),
  collapses to 72 px icons with tooltips and dot badges (`[` toggles, remembered per browser). Phones: bottom bar + More sheet.
- **Type.** Inter UI/data with tabular figures; Montserrat for titles and brand; mono only for references (`.ref`).
  Scale tokens `text-2xs` 11 · `caption` 12 · `meta` 13 · `body` 14 · `lead` 15 · `section` 18 · `title` 22 · `display` 28.
- **Colour.** Console light/dark token sets in `tokens.json` (`console`, `dark`); links royal (`text-link`), focus ring royal
  (light) / blue-400 (dark); orange is the active indicator and attention colour, never link text.
- **Layers.** `z-sticky` 10 < `z-header` 30 < `z-rail` 35 < `z-dropdown` 40 < `z-overlay` 50 < `z-modal` 60 < `z-toast` 70 < `z-tooltip` 80.
- **Lists.** `ListPage` + `Toolbar` (fixed count slot, controls never reflow) + `ListCard fill` + `GridScroll`/`TableScroll`:
  the card is the scroll container, the header sticks with no gap, wide tables scroll inside the card.
- **Controls.** Native inputs restyled in `globals.css`: checkbox and radio boxes are fixed size and draw the mark with a mask,
  so nothing moves on click; `Switch` (`role="switch"`) keeps a fixed label; `Segmented` is a radio group with arrow keys;
  `Tip` is the tooltip for icon-only controls. Scrollbars are thin and themed, never hidden.
- **Dashboard.** KPI cards, requests-submitted chart (14/30/90 days), open requests by stage, first-contact SLA outcome and
  invoices come from `GET /v1/admin/dashboard/metrics` (real counts; money only with `pricing.read.internal`). Charts are SVG
  on `--viz-*` tokens with tooltips, keyboard focus, a screen-reader table and an empty state.
- **Feedback.** Toasts bottom-end, above every layer, with close buttons; the bell is a notification centre over the live
  queue counts (no persistent staff inbox exists in the API yet).

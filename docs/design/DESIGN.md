# UniTravel — design direction (UI policy §21)

## Product analysis
- **Customers** (Iran, diaspora, students): anxious, high-stakes journeys assembled from fragments; often on
  slow or filtered connections, Persian-first. They need honesty (truth badges), plain status words, and a human
  behind the request. Touch-first on mobile web; the website is the guaranteed channel (ch. 29.3).
- **Admins**: phone-centric case work; one screen per case, commands not fields, keyboard-friendly.
- **Developers/owner**: control room — versioned config, health, audit.

## Direction: "Cartographer's ledger"
Taken from the booklet cover: a night-navy chart with copper route arcs. The customer site reads like a calm
editorial travel document; the console reads like a ledger.

| | Customer web / mobile | Admin Panel | Developer Panel |
|---|---|---|---|
| Personality | Calm, editorial, reassuring | Dense, precise, quiet | Technical control room |
| Density | Airy, large type | Compact 13–14 px, tables | Compact, monospace values |
| Navigation | Top bar + footer; mobile bottom bar | Left rail (queues) + 3-column case workspace + `j/k/c/n` keys | Section rail + versioned editors |
| Primary view | Search hero over route-arc map → result cards | Master/detail queue → case workspace | Forms with draft → simulate → publish |
| Motion | Arc draw-in on hero, fade-in results | None beyond focus/hover | None |

## Tokens
- Navy `#0F2238` (ink), Deep `#13263F`, Copper `#C98D5B` / `#B07A45` (accent), Sand `#F5F1EA` (paper),
  Mist `#E6E1D8` (lines), Moss `#3F6B4F` (confirmed), Brick `#A4452C` (risk), Slate `#5B6573` (secondary text).
- Truth badge tones: LIVE = moss outline, CACHED = slate outline, PRICED/CONFIRMED = moss solid, MANUAL = copper,
  FAKE = brick striped, SEPARATE TICKETS = brick outline, GATEWAY = copper outline. Always text, never colour alone.
- Type: **Fraunces** (display, Latin), **Inter** (UI), **Vazirmatn** (Persian, display and UI),
  **JetBrains Mono** (references, codes, dev values). All self-hosted (no Google Fonts — ch. 28.4).
- Radius 10 px cards / 8 px controls; hairline borders over shadows; 4 px spacing grid.
- RTL: logical properties only; numbers, flight numbers and references wrapped in LTR isolates (ch. 29.4).

## Patterns adapted (not cloned)
- `components/web/ui` (shadcn Base UI primitives) restyled on these tokens.
- `components/web/workflow` ideas (StatusBadge, Timeline, SlaIndicator) re-implemented to the request lifecycle.
- Console case workspace inspired by support-desk master/detail (UI policy §3 "Support"), not a dashboard.

## Accessibility
WCAG 2.2 AA: 4.5:1 contrast, visible focus rings (copper 2 px), labels on every input, errors tied to fields,
status changes in `aria-live` regions, 32 px minimum touch targets (seat map), no colour-only meaning.

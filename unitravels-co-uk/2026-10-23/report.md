# Design Thief Report

**Website:** unitravels.co.uk  
**Page:** https://unitravels.co.uk/  
**Analyzed:** 2026-10-23T13:43:43.840Z · 50 of 50 elements · 930 ms

## Color roles

| Role | Value | Evidence |
|---|---|---|
| primary | #ff8617 | INFERRED — most frequent saturated color (3 uses) |
| secondary | #ffac50 | INFERRED — third saturated color (2 uses) |
| accent | #11b7ff | INFERRED — second most frequent saturated color (1 uses) |
| pageBackground | #ffffff | DETECTED — computed background of <body>/<html> |
| surface | #ffffff14 | INFERRED — largest non-page background area (6 containers) |
| card | — | UNAVAILABLE — no reliable evidence on this page |
| text | #ffffff | DETECTED — most-used body text color across 11 elements |
| heading | #ffffff | DETECTED — color of heading elements (3) |
| muted | — | UNAVAILABLE — no reliable evidence on this page |
| link | — | UNAVAILABLE — no reliable evidence on this page |
| border | #ffffff24 | DETECTED — most frequent border color (24 elements) |
| input | — | UNAVAILABLE — no reliable evidence on this page |
| inputBorder | — | UNAVAILABLE — no reliable evidence on this page |
| buttonBackground | #ffffff1a | INFERRED — most common button background (3 elements) |
| buttonText | #ffffff | INFERRED — text color of the most common button |
| hover | #ffffff2e | DETECTED — from :hover rule .contact a:hover |
| focus | — | UNAVAILABLE — no reliable evidence on this page |
| active | — | UNAVAILABLE — no reliable evidence on this page |
| disabled | — | UNAVAILABLE — no reliable evidence on this page |
| success | — | UNAVAILABLE — no reliable evidence on this page |
| warning | — | UNAVAILABLE — no reliable evidence on this page |
| error | — | UNAVAILABLE — no reliable evidence on this page |
| info | — | UNAVAILABLE — no reliable evidence on this page |

## Typography

Heading font: **Vazirmatn** · Body font: **Montserrat**

| Level | Family | Size | Weight | Line height | Evidence |
|---|---|---|---|---|---|
| Display | Vazirmatn | 51.2px | 800 | 58.88px | INFERRED — largest text style above H1 |
| H1 | Montserrat | 30.4px | 700 | normal | DETECTED — <h1> elements |
| H2 | Vazirmatn | 51.2px | 800 | 58.88px | DETECTED — <h2> elements |
| H3 | Vazirmatn | 17.6px | 800 | normal | DETECTED — <h3> elements |
| Body | Montserrat | 12.48px | 400 | normal | DETECTED — most-used paragraph/list text style |
| Small | Montserrat | 11.2px | 400 | normal | INFERRED — frequent text style just below body size |
| Caption | Vazirmatn | 16px | 700 | 18.4px | DETECTED — <figcaption>/<small>/<time> elements |

### Font families

- **Vazirmatn** — google-fonts, used for heading, body (14 elements)
- **Font Awesome 6 Free** — third-party, used for icon (10 elements)
- **Montserrat** — google-fonts, used for heading, body (5 elements)

## Components (inferred)

### button — 3 instances, confidence 0.74

Signals: link styled as button (3); padding + background/border (3)

**secondary** (3×) — `div.contact:nth-of-type(4) > a:nth-of-type(1)`

- Background: #ffffff1a
- Text: #ffffff
- Border: 1px solid #ffffff29
- Radius: 16px
- Font: Vazirmatn 16px
- Weight: 700
- Padding: 12px 18px
- Shadow: none
- Hover: transform translateY(-2px), background-color #ffffff2e

### footer — 1 instances, confidence 0.92

Signals: <footer> (1)

**default** (1×) — `footer`

- Background: transparent
- Text: #ffffff
- Border: none
- Radius: 0
- Font: Montserrat 11.2px
- Weight: 400
- Padding: 0px
- Shadow: none
- Hover: not found in readable CSS

### link — 1 instances, confidence 0.95

Signals: <a href> (1)

**default** (1×) — `div.powered-by > a`

- Background: transparent
- Text: #ffac50
- Border: none
- Radius: 0
- Font: Montserrat 10.88px
- Weight: 700
- Padding: 0px
- Shadow: none
- Hover: not found in readable CSS

## Spacing

INFERRED — from 70 margin/padding/gap values; no consistent base unit

Scale: 9px, 10px, 12px, 13px, 14px, 18px, 22px, 26px, 32px, 34px, 70px

## Radii

- 50% → circle (9×)
- 16px → large (9×)
- 999px → pill (1×)

## Shadows

- **xs** `inset 0px 0px 0px 4px rgba(255, 255, 255, 0.08)` (1×)

## Gradients

- `linear-gradient(150deg, rgb(6, 31, 76) 0%, rgb(8, 53, 117) 46%, rgb(12, 103, 185) 100%)` (1×)
- `linear-gradient(to right, rgba(0, 0, 0, 0), rgb(255, 134, 23))` (1×)
- `linear-gradient(to left, rgba(0, 0, 0, 0), rgb(255, 134, 23))` (1×)

## Breakpoints

DETECTED — widths read from @media rules; device labels inferred from ranges

- Mobile: 340px (3 rules)
- Mobile: 480px (3 rules)
- Mobile: 520px (7 rules)

## Icon systems

- Font Awesome — confidence 0.95, 10 icons (fa-* classes)

## Assets

Images: 1
- og-image.png [image] → assets/images/og-image.png
  source: https://unitravels.co.uk/share.png

SVG: 0

Icons: 1
- favicon.ico [favicon] → not saved (Could not download this asset. The server says it no longer exists.)
  source: https://unitravels.co.uk/favicon.ico

Fonts: 16
- font-montserrat-600.woff2 [font] → assets/fonts/font-montserrat-600.woff2
  source: https://fonts.gstatic.com/s/montserrat/v31/JTUSjIg1_i6t8kCHKm459WRhyzbi.woff2
- font-montserrat-600-d2653b.woff2 [font] → assets/fonts/font-montserrat-600-d2653b.woff2
  source: https://fonts.gstatic.com/s/montserrat/v31/JTUSjIg1_i6t8kCHKm459W1hyzbi.woff2
- font-montserrat-600-e1352c.woff2 [font] → assets/fonts/font-montserrat-600-e1352c.woff2
  source: https://fonts.gstatic.com/s/montserrat/v31/JTUSjIg1_i6t8kCHKm459WZhyzbi.woff2
- font-montserrat-600-6d4147.woff2 [font] → assets/fonts/font-montserrat-600-6d4147.woff2
  source: https://fonts.gstatic.com/s/montserrat/v31/JTUSjIg1_i6t8kCHKm459Wdhyzbi.woff2
- font-montserrat-600-e1eef2.woff2 [font] → assets/fonts/font-montserrat-600-e1eef2.woff2
  source: https://fonts.gstatic.com/s/montserrat/v31/JTUSjIg1_i6t8kCHKm459Wlhyw.woff2
- font-vazirmatn-400.woff2 [font] → assets/fonts/font-vazirmatn-400.woff2
  source: https://fonts.gstatic.com/s/vazirmatn/v16/Dxxo8j6PP2D_kU2muijlGMWWMmk.woff2
- font-vazirmatn-400-8cac08.woff2 [font] → assets/fonts/font-vazirmatn-400-8cac08.woff2
  source: https://fonts.gstatic.com/s/vazirmatn/v16/Dxxo8j6PP2D_kU2muijlE8WWMmk.woff2
- font-vazirmatn-400-9a7848.woff2 [font] → assets/fonts/font-vazirmatn-400-9a7848.woff2
  source: https://fonts.gstatic.com/s/vazirmatn/v16/Dxxo8j6PP2D_kU2muijlHcWW.woff2
- font-awesome-6-brands-400.woff2 [font] → assets/fonts/font-awesome-6-brands-400.woff2
  source: https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-brands-400.woff2
- font-awesome-6-brands-400.ttf [font] → assets/fonts/font-awesome-6-brands-400.ttf
  source: https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-brands-400.ttf
- font-awesome-6-free-400.woff2 [font] → assets/fonts/font-awesome-6-free-400.woff2
  source: https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-regular-400.woff2
- font-awesome-6-free-400.ttf [font] → assets/fonts/font-awesome-6-free-400.ttf
  source: https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-regular-400.ttf
- font-awesome-6-free-900.woff2 [font] → assets/fonts/font-awesome-6-free-900.woff2
  source: https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-solid-900.woff2
- font-awesome-6-free-900.ttf [font] → assets/fonts/font-awesome-6-free-900.ttf
  source: https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-solid-900.ttf
- font-awesome-400.woff2 [font] → assets/fonts/font-awesome-400.woff2
  source: https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-v4compatibility.woff2
- font-awesome-400.ttf [font] → assets/fonts/font-awesome-400.ttf
  source: https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/fa-v4compatibility.ttf

Lottie: 0

Video / audio: 0


## Issues and gaps

None recorded.
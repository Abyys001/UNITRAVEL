# Brand assets

Brand: Uni Travel (unitravels.co.uk). Palette, fonts and logo follow the owner-supplied capture in
`unitravels-co-uk/2026-10-23/` (navy #061f4c → royal #0c67b9, orange #ff8617, cyan #11b7ff; Montserrat + Vazirmatn).
Direction and tokens: `docs/design/DESIGN.md` ("Night flight", revised 2026-10-23).

| File | What | Used by |
|---|---|---|
| `logo/mark.svg` | Vector redraw of the globe-and-swoosh mark (same artwork as `packages/ui/src/brand/logo.tsx`) | web/console `icon.svg`, OG |
| `logo/mark-512.png`, `logo/mark-1024.png` | Transparent PNG renders of the mark | Flutter app, documents |
| `logo/app-icon-fullbleed.png` (1024²) | Mark on the brand gradient, full bleed | iOS/Android/web app icons, `apps/web/src/app/apple-icon.png` |
| `logo/adaptive-foreground.png` (1024²) | Mark only, inset for Android adaptive icons | Android |
| `app-icon.png` / `app-icon-fullbleed.png` | Rounded-corner and full-bleed copies of the app icon | store listings |
| `og-image.png` (1200×630) | Social share image: logo, headline, hero poster behind the orange ribbon curve | `apps/web/src/app/[locale]/opengraph-image.png`, `twitter-image.png` |
| `title-card.png`, `end-card.png`, `app-promo*.png` | **Previous "Cartographer's ledger" look (Canva, 22 Oct 2026) — superseded**; used by the old teaser in `media/teaser/` | teaser only |

Rendering: PNGs are rendered from the SVG/HTML with headless Chromium (Playwright) at the sizes above, fonts from the
engineering kit (`fonts/montserrat`, `fonts/vazirmatn`); derived icon sizes with ImageMagick.

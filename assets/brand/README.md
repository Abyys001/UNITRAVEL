# Brand assets

Designed in Canva (22–23 Oct 2026) from the "Cartographer's ledger" direction in `docs/design/DESIGN.md`
(navy #0F2238, copper #C98D5B, sand #F5F1EA; Fraunces + Inter). Edit in Canva and re-export at the sizes below.

| File | Canva design | Used by |
|---|---|---|
| `og-image.png` (1200×630) | [Uni Travel social share image](https://www.canva.com/d/-y2fTp9yF34vTHC) | `apps/web/src/app/[locale]/opengraph-image.png`, `twitter-image.png` |
| `app-icon.png` (1024², corners white) / `app-icon-fullbleed.png` | [Uni Travel app icon](https://canva.link/k8euutkt94b459l) | Flutter iOS AppIcon, Android mipmaps, web icons/favicon; `apps/web/src/app/apple-icon.png` |
| `title-card.png` (1920×1080) | [Uni Travel title card](https://www.canva.com/d/zIm7f5AUkhjb3Cr) | teaser opening |
| `end-card.png` (1920×1080) | [Uni Travel End Card](https://canva.link/15tiqw51o9c3znq) | teaser closing |
| `app-promo.png` (1013×1350) / `app-promo-with-screen.png` | [Uni Travel Instagram promo](https://www.canva.com/d/uk8W3g6r_z8fXht) | store/social promo; the second has a real app screenshot composited into the frame |

Derived sizes are generated with ImageMagick (see the commands in the build log); regenerate from the full-bleed icon.

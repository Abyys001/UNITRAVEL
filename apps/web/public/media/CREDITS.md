# Media credits

Stock media for the UniTravel customer website, sourced 2026-10-23. All items are under the
[Pexels licence](https://www.pexels.com/license/) or the [Unsplash licence](https://unsplash.com/license):
free commercial use, attribution not required (we credit anyway). Unsplash+ items were excluded.
Raw files were downloaded from the public CDN file URLs (videos.pexels.com, images.pexels.com,
images.unsplash.com). No API keys and no authenticated pages were used.

| Output file(s) | Subject | Source page | Author | Licence | Downloaded | Edits applied |
|---|---|---|---|---|---|---|
| `video/hero.webm`, `video/hero.mp4`, `video/hero-poster.jpg`, `video/hero-poster.webp` | Aircraft wing over the clouds at dusk, orange horizon band | https://www.pexels.com/video/an-aircraft-wing-9525409/ | MissDeena Travels | Pexels | 2026-10-23 | 2560x1440 source scaled to 1280x720, 30 fps, audio removed; 11.4 s loop (source 1.0–11.4 s, then the last 1 s crossfades into source 0–1 s so the end matches the first frame); VP9 CRF 30 two-pass and H.264 High CRF 22 with faststart; poster is the first loop frame (source 1.0 s) at 1600w |
| `video/signin.webm`, `video/signin.mp4`, `video/signin-poster.jpg`, `video/signin-poster.webp` | Sunset over an airport apron and runway, seen from the terminal | https://www.pexels.com/video/the-sun-sets-over-an-airport-runway-19202918/ | Hacıilyas Sever | Pexels | 2026-10-23 | Portrait source (1440x2560) cropped to 744x992 at (0,540) so that no aircraft or airline livery and wordmarks are in frame, then scaled to 960x1280 (3:4); audio removed; 7.8 s loop (source 16.4–23.0 s, then a 1.2 s crossfade of 23.0–24.2 into 15.2–16.4); VP9 CRF 32 two-pass and H.264 High CRF 24 with faststart; poster is the first loop frame |
| `photos/istanbul.avif`, `photos/istanbul.webp`, `photos/istanbul-600.webp` | Ortaköy Mosque and the Bosphorus Bridge at sunset | https://unsplash.com/photos/O1n-f15L668 | Spenser Sembrat | Unsplash | 2026-10-23 | Resized to 1200w (4:3) as AVIF q55 and WebP q72, plus 600w WebP; metadata stripped |
| `photos/yerevan.avif`, `photos/yerevan.webp`, `photos/yerevan-600.webp` | Yerevan at dusk with Mount Ararat (both peaks) | https://unsplash.com/photos/OfRkyh3xYoI | Aleksandr Popov | Unsplash | 2026-10-23 | Resized to 1200w (3:2) as AVIF q55 and WebP q72, plus 600w WebP; metadata stripped |
| `photos/london.avif`, `photos/london.webp`, `photos/london-600.webp` | Aerial view of Tower Bridge and the Thames toward Canary Wharf | https://unsplash.com/photos/6b3r1WAjPBI | Sander Crombach | Unsplash | 2026-10-23 | Resized to 1200w (3:2) as AVIF q55 and WebP q72, plus 600w WebP; metadata stripped |
| `photos/tehran.avif`, `photos/tehran.webp`, `photos/tehran-600.webp` | Aerial view of Tehran with Milad Tower and the Alborz foothills | https://unsplash.com/photos/qNZJc3V9R2A | KAMRAN gholami | Unsplash | 2026-10-23 | Resized to 1200w (16:9) as AVIF q55 and WebP q72, plus 600w WebP; metadata stripped |
| `photos/muscat.avif`, `photos/muscat.webp`, `photos/muscat-600.webp` | Sultan Qaboos Grand Mosque, Muscat, under a blue sky | https://unsplash.com/photos/xbLE8qOTPoY | Daniele Levis Pelusi | Unsplash | 2026-10-23 | Resized to 1200w (3:2) as AVIF q55 and WebP q72, plus 600w WebP; metadata stripped |
| `photos/tbilisi.avif`, `photos/tbilisi.webp`, `photos/tbilisi-600.webp` | Tbilisi old town at blue hour with the floodlit Narikala Fortress | https://unsplash.com/photos/K_ZHR_uNY30 | Viktor SOLOMONIK | Unsplash | 2026-10-23 | Resized to 1200w (3:2) as AVIF q55 and WebP q72, plus 600w WebP; metadata stripped |
| `photos/cargo.avif`, `photos/cargo.webp` | Empty main-deck hold of a freighter, with roller and ball-mat floor for ULDs | https://www.pexels.com/photo/interior-view-of-an-empty-cargo-plane-32509735/ | Ramaz Bluashvili | Pexels | 2026-10-23 | Resized to 1600w (3:2) as AVIF q55 and WebP q72; metadata stripped |
| `photos/travel.avif`, `photos/travel.webp` | Silhouette of a traveller at a terminal window at sunset (no face visible) | https://unsplash.com/photos/ltCNpYiJPRg | Alex Alvarez | Unsplash | 2026-10-23 | Resized to 1600w (3:2) as AVIF q55 and WebP q72; metadata stripped |

## App intro video

`app/coming-soon.mp4` and its poster are original: animation from `scripts/app-teaser/scene.html`, music synthesised by `scripts/app-teaser/music.py`. Fonts are Alexandria, Vazirmatn and Montserrat (OFL). No stock or licensed media.

`app/screens/*.webp` are screens captured from the Uni Travel app with `scripts/app-teaser/screens.mjs`.

## Iranian destinations (villas and stays page)

From Wikimedia Commons, sourced 2026-11-01 through its public API, under the Creative Commons or public-domain licence named in each row. These licences require credit (the stays page links here), and CC BY-SA crops stay under the same licence. They show the destination, never a listed property.

| Output file(s) | Source title | Source page | Author | Licence | Downloaded | Edits applied |
|---|---|---|---|---|---|---|
| `photos/iran/isfahan.avif`, `photos/iran/isfahan.webp` | Naqsh-e Jahan Square from the gheisariye Vault | https://commons.wikimedia.org/wiki/File:Naqsh-e_Jahan_Square_from_the_gheisariye_Vault.jpg | Amir Pashaei | CC BY-SA 4.0 | 2026-11-01 | Cropped to 4:3, resized to 1280w, AVIF q55 and WebP q72; metadata stripped |
| `photos/iran/shiraz.avif`, `photos/iran/shiraz.webp` | Mezquita de Nasirolmolk, Shiraz, Irán, 2016-09-24, DD 66-68 HDR | https://commons.wikimedia.org/wiki/File:Mezquita_de_Nasirolmolk,_Shiraz,_Ir%C3%A1n,_2016-09-24,_DD_66-68_HDR.jpg | Diego Delso | CC BY-SA 4.0 | 2026-11-01 | Cropped to 4:3, resized to 800w, AVIF q55 and WebP q72; metadata stripped |
| `photos/iran/yazd.avif`, `photos/iran/yazd.webp` | Iran 0141 (3471698834) | https://commons.wikimedia.org/wiki/File:Iran_0141_(3471698834).jpg | Ninara from Helsinki, Finland | CC BY 2.0 | 2026-11-01 | Cropped to 4:3, resized to 800w, AVIF q55 and WebP q72; metadata stripped |
| `photos/iran/kashan.avif`, `photos/iran/kashan.webp` | Casa histórica de Tabatabaeis, Kashan, Irán, 2016-09-19, DD 64 | https://commons.wikimedia.org/wiki/File:Casa_hist%C3%B3rica_de_Tabatabaeis,_Kashan,_Ir%C3%A1n,_2016-09-19,_DD_64.jpg | Diego Delso | CC BY-SA 4.0 | 2026-11-01 | Cropped to 4:3, resized to 800w, AVIF q55 and WebP q72; metadata stripped |
| `photos/iran/tabriz.avif`, `photos/iran/tabriz.webp` | Tabriz Traditional Market | https://commons.wikimedia.org/wiki/File:Tabriz_Traditional_Market.jpg | Alireza abbasiyan | CC BY-SA 4.0 | 2026-11-01 | Cropped to 4:3, resized to 800w, AVIF q55 and WebP q72; metadata stripped |
| `photos/iran/mashhad.avif`, `photos/iran/mashhad.webp` | Imam Reza shrine | https://commons.wikimedia.org/wiki/File:Imam_Reza_shrine.jpg | mohammad hosein tabatabaeian | CC BY-SA 3.0 | 2026-11-01 | Cropped to 4:3, resized to 800w, AVIF q55 and WebP q72; metadata stripped |
| `photos/iran/kerman.avif`, `photos/iran/kerman.webp` | Ganjali Khan Complex, Kerman 01 | https://commons.wikimedia.org/wiki/File:Ganjali_Khan_Complex,_Kerman_01.jpg | Bernard Gagnon | CC BY-SA 4.0 | 2026-11-01 | Cropped to 4:3, resized to 800w, AVIF q55 and WebP q72; metadata stripped |
| `photos/iran/kermanshah.avif`, `photos/iran/kermanshah.webp` | Taq-e-Bostan plan | https://commons.wikimedia.org/wiki/File:Taq-e-Bostan_plan.jpg | Peymanpakzad | CC BY-SA 4.0 | 2026-11-01 | Cropped to 4:3, resized to 800w, AVIF q55 and WebP q72; metadata stripped |
| `photos/iran/kish.avif`, `photos/iran/kish.webp` | Sand Beach on Kish Island, Iran | https://commons.wikimedia.org/wiki/File:Sand_Beach_on_Kish_Island,_Iran.jpg | Ivan Mlinaric from Slovenia | CC BY 2.0 | 2026-11-01 | Cropped to 4:3, resized to 800w, AVIF q55 and WebP q72; metadata stripped |
| `photos/iran/qeshm.avif`, `photos/iran/qeshm.webp` | Stars Valley (148088379) | https://commons.wikimedia.org/wiki/File:Stars_Valley_(148088379).jpeg | Esmail Golshan Mojdehi | CC BY-SA 3.0 | 2026-11-01 | Cropped to 4:3, resized to 800w, AVIF q55 and WebP q72; metadata stripped |
| `photos/iran/ramsar.avif`, `photos/iran/ramsar.webp` | Mazandaran Province, Ramsar Coastal Bypass Fwy, Iran - panoramio (1) | https://commons.wikimedia.org/wiki/File:Mazandaran_Province,_Ramsar_Coastal_Bypass_Fwy,_Iran_-_panoramio_(1).jpg | هاوبەشی مامە دارا | CC BY 3.0 | 2026-11-01 | Cropped to 4:3, resized to 800w, AVIF q55 and WebP q72; metadata stripped |
| `photos/iran/masuleh.avif`, `photos/iran/masuleh.webp` | MasulehView | https://commons.wikimedia.org/wiki/File:MasulehView.JPG | Far-gh | CC BY-SA 4.0 | 2026-11-01 | Cropped to 4:3, resized to 800w, AVIF q55 and WebP q72; metadata stripped |
| `photos/iran/shushtar.avif`, `photos/iran/shushtar.webp` | Shooshtar Ancient Water Mills باقی مانده های آسیابهای آبی شوشتر - panoramio | https://commons.wikimedia.org/wiki/File:Shooshtar_Ancient_Water_Mills_%D8%A8%D8%A7%D9%82%DB%8C_%D9%85%D8%A7%D9%86%D8%AF%D9%87_%D9%87%D8%A7%DB%8C_%D8%A2%D8%B3%DB%8C%D8%A7%D8%A8%D9%87%D8%A7%DB%8C_%D8%A2%D8%A8%DB%8C_%D8%B4%D9%88%D8%B4%D8%AA%D8%B1_-_panoramio.jpg | Alireza Shakernia | CC BY-SA 3.0 | 2026-11-01 | Cropped to 4:3, resized to 800w, AVIF q55 and WebP q72; metadata stripped |

`photos/tehran.*` above is also used on that page.

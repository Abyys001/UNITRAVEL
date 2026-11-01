# ADR-0026: Mobile app paused; public site shows Coming Soon only

- Status: accepted (owner request, 1 Nov 2026: halt mobile development; disable downloads and the web version; introduce the app with a video that says Coming Soon)
- Scope: public access to the mobile app. Amends ADR-0002 only in that the Flutter app is not offered to anyone for now.

## Decision
- `/[locale]/app` shows a heading, a Coming Soon badge and an intro video. It has no download, TestFlight or web version options, not even disabled ones.
- The landing page's app section says Coming Soon and links to that page. Amended by the owner the same day: real app screens may be shown on a 3D phone, but never flight results or prices (local results come from the fake adapter) or personal data.
- On the mobile host, nginx redirects `/` and `/app/` to the website's `/app`. `/v1/` and `/health` stay because the public API shares the host.
- `flutter_service_worker.js` is replaced by a script that unregisters itself, so past visitors do not keep opening a cached copy.
- The video is original: animation and music are generated from `scripts/app-teaser/`, with no licensed media and no launch date.

## Consequences
- Flutter code, tests and the Docker `mobile` service stay in the repo, so work can resume by reverting the nginx block and the page. The service is not reachable from outside.
- `apps/mobile/e2e/smoke.mjs` and `scripts/teaser` need the local build served to run; `scripts/svc.sh start mobile` still does that.
- Copy about the app is future tense until the owner reverses this.

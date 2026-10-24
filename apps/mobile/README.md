# UniTravel mobile (Flutter)

One app, two modes. **Customer mode** (search, request, track, cargo, inbox, account) and **admin mode**
(triage queue, my cases, inbox, account) are chosen from `GET /v1/me` -> `surfaces.admin` (booklet ch. 10.5).
English and Persian (RTL), Gregorian or Jalali dates, bearer-token auth. ADR-0002.

## Stack

Flutter 3.47 / Dart 3.13, Riverpod 3, go_router, Dio, `kit_ui` (copied from the engineering kit into
`packages/kit_ui`), `flutter_secure_storage` (refresh token), `shared_preferences` (offline JSON cache),
`shamsi_date` (Jalali), `crypto` (proof of work), `url_launcher` (`tel:`). Fonts: Montserrat, Vazirmatn
(self-hosted in `assets/fonts`, no CDN; the web build is made with `--no-web-resources-cdn`).

```
lib/core        api client (401 recovery), session, token store, cache, formatting (Jalali), repos
lib/models      hand-written JSON views of the contract (packages/contracts)
lib/features    auth, search (form/results/itinerary), requests, cargo, inbox, account, admin
lib/l10n        ARB files, generated from tool/gen_arb.py (one table, so EN and FA cannot drift)
packages/kit_ui shared UI kit (not edited here)
e2e/            Playwright smoke test against the web build
```

## How the 401 contract works (`lib/core/session.dart`, `api_client.dart`)

* Every call carries `x-device-id`, `x-client-platform`, `accept-language`, and `authorization: Bearer` once signed in.
* On `401 PERMISSIONS_CHANGED | TOKEN_EXPIRED | UNAUTHENTICATED` the client refreshes (`POST /v1/auth/refresh`,
  rotating both tokens), reloads `/v1/me`, rebuilds navigation (admin mode appears or disappears) and retries the
  call **once**. Concurrent failures share one refresh. A rejected refresh token signs the user out.
* Cold start with no network keeps the cached profile and requests; screens show "offline, last updated".
* Staff calls that answer `MFA_REQUIRED` / `STEP_UP_REQUIRED` show the TOTP gate (enrols a factor first when needed).

## Run

```sh
cd apps/mobile
export PATH=$PATH:/home/siavash/applications/development/flutter/bin
flutter pub get
python3 tool/gen_arb.py && flutter gen-l10n      # only after editing tool/gen_arb.py
flutter analyze
flutter test
flutter build web --release --no-web-resources-cdn
```

The API must run at `http://localhost:4100` (`scripts/svc.sh start api worker`); override with
`--dart-define=API_URL=https://...`. Serve the build (CORS allows `http://localhost:4300`):

```sh
scripts/svc.sh start mobile          # python http.server on build/web, port 4300
```

The app uses hash URLs so any static host works without a history fallback. Deep link for an SMS short link:
`http://localhost:4300/#/requests/UT-F-XXXXXX` (staff land on the case instead).
Add `?semantics` to the page URL to turn on the accessibility tree up front (used by the Playwright test):
`http://localhost:4300/?semantics`.

If `flutter test` fails with `Unable to connect to flutter_tester process`, a shell HTTP proxy is intercepting
localhost: run it as `env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY flutter test`.

## Tests

* `flutter test` (unit + widget): 401 / permission-refresh logic (single flight, retry once, sign-out, offline cold
  start), Jalali and money formatting, proof of work, navigation rules, search form -> contract body, RTL sign-in.
* `e2e/smoke.mjs` (Playwright driving the release web build and the real API):

```sh
scripts/svc.sh start api worker mobile
cd apps/mobile/e2e && npm install        # once; uses the system Chromium (/usr/bin/chromium), override with CHROMIUM=
node smoke.mjs
```

It signs in with a fresh `+98912…` number in Persian (RTL), searches THR -> LON, submits a manual request and an
itinerary request, checks the offline cache, promotes the customer to admin through the Developer Panel API
(owner `+447700900001`, host `dev.localhost:4200`, TOTP `KVXGSVDSMF3GK3CEMVWW6VCPKRIDEMBSGY`), and asserts admin mode
appears on the app's next call, then enrols TOTP, opens the queue and a case. A second pass runs in English.
Screenshots land in `test-artifacts/`; `test-artifacts/smoke-results.json` has the step results.
The owner's refresh cookie is cached in `e2e/.owner-session.json` (git-ignored) so repeated runs do not hit the
per-number OTP cooldown (it doubles on every request).

## Scope notes

* Admin mode is triage only (ch. 15.8): claim, request info, message, internal note, log a call, `tel:` link,
  on-duty toggle. No quote sending, reservation/ticket records, payments or compliance decisions on mobile v1.
* Cargo requests cover DOCUMENTS and PARCEL on enabled lanes; air freight and excess baggage stay on the web.
* On web the device registers a placeholder Expo push token (`PUSH_PLACEHOLDER`, default on) so the
  `/v1/me/devices` path is exercised; real FCM/APNs credentials are a Stage 0 item.
* Jalali: dates display in the user's calendar preference (with the other calendar beside it); the picker itself is
  Gregorian.

# Mobile app brief (Flutter — ADR-0002)

Build `apps/mobile`: one Flutter app with **customer mode** and **admin mode**, chosen from `GET /v1/me`
(`surfaces.admin`). Tested through the **Flutter web build** served on `http://localhost:4300`
(`scripts/svc.sh start mobile` serves `apps/mobile/build/web`). The API runs at `http://localhost:4100`
(CORS allows `http://localhost:4300`). Booklet references: ch. 10.5, 11, 15.8, 17, 29.3–29.5 (`docs/booklet.txt`).

## Stack (kit)
Start from `~/Projects/01_engineering-kit/starters/flutter-app` (Riverpod 3, go_router, Dio, `kit_ui`).
Copy `~/Projects/01_engineering-kit/components/flutter` into `apps/mobile/packages/kit_ui` and depend on it by
path (never edit the kit itself). Remove Better Auth/cookie code: this API uses **bearer tokens** for mobile.
Add `flutter_secure_storage` (refresh token), `shamsi_date` (Jalali), keep `shared_preferences` (offline cache).
Fonts: Vazirmatn + Inter from the kit's assets. Brand per `docs/design/DESIGN.md` (navy `#0F2238`,
copper `#C98D5B`, sand `#F5F1EA`).

## API contract (all JSON, see `packages/contracts/src/*.ts` for exact Zod schemas)
- Headers on every call: `x-device-id: <stable random id>`, `x-client-platform: web|android|ios`,
  `accept-language: en|fa`, `authorization: Bearer <access>` once signed in.
- Sign-in: `POST /v1/auth/otp/request {channel:"PHONE", value, deviceId, client:"MOBILE"}` → 202
  `{challengeId, resendAfterSeconds, normalised}`. If 428 `CHALLENGE_REQUIRED` the body has `challenge`
  `{algorithm, challenge, salt, maxnumber, signature}`: find n in 0..maxnumber with sha256(salt+n) == challenge,
  resend with `challenge: base64(json{algorithm,challenge,number,salt,signature})`.
  `POST /v1/auth/otp/verify {challengeId, code, deviceId, client:"MOBILE", profile?}` → `{isNewUser, needsProfile,
  mfaRequired, mfaEnrolmentRequired, tokens:{accessToken, refreshToken,…}}`.
  `POST /v1/auth/refresh {refreshToken}` rotates both tokens. On **401 `PERMISSIONS_CHANGED`** or
  `TOKEN_EXPIRED`: refresh silently, call `GET /v1/me`, rebuild navigation (admin mode appears/disappears),
  retry once (ch. 10.5). Errors are RFC 9457 `{code, title, detail, errors[{path,message}]}`.
- Local dev OTP codes: `GET /v1/dev-sink/sms` (newest first) — only for tests, never in the app UI.
- Me: `GET /v1/me`, `PATCH /v1/me {preferredLocale, calendar, givenNamesLatin, surnameLatin, nameFa, onDuty}`.
- Staff second factor (needed for `/v1/admin/*` when `mfaRequired`/`mfaEnrolmentRequired`):
  `POST /v1/auth/mfa/totp/enrol` → `{secret, otpauthUrl}`; `POST /v1/auth/mfa/totp/verify {type:"TOTP", code}`.
  Demo staff share TOTP secret `KVXGSVDSMF3GK3CEMVWW6VCPKRIDEMBSGY` (local only).
- Search: `POST /v1/flight-searches` (SearchQuery) → 202 `{id}`; poll `GET /v1/flight-searches/:id?tab=BEST|CHEAPEST|FASTEST|SINGLE_TICKET&limit=20`
  every 1.5 s with back-off until `status != RUNNING` (polling, not SSE, on mobile — ch. 29.3).
  Places: `GET /v1/locations?q=teh` → `[{kind, code, nameEn, nameFa}]`; send `{city:"THR"}` or `{airport:"IKA"}`.
- Itinerary: `GET /v1/itineraries/:id`, `POST /v1/itineraries/:id/price-check`.
- Requests: `POST /v1/flight-requests` (ITINERARY or MANUAL; `Idempotency-Key` header),
  `GET /v1/requests` (flight + cargo list), `GET /v1/flight-requests/:ref`, `POST …/:ref/messages {body}`,
  `POST …/:ref/quotes/:quoteId/accept {optionId}`, `POST …/:ref/cancel`.
- Travellers: `GET/POST/PATCH /v1/me/travellers`. Inbox: `GET /v1/notifications`, `POST /v1/notifications/read {all:true}`.
- Devices: `POST /v1/me/devices {platform, pushProvider:"EXPO"|"PUSHY", pushToken}` (register a placeholder token on
  web builds behind a feature flag; real FCM/APNs credentials are a Stage 0 item).
- Cargo (customer): `GET /v1/cargo/lanes`, `POST /v1/cargo-requests`, `GET /v1/cargo-requests/:ref`.
- Admin mode (ch. 15.8 — triage only): `GET /v1/admin/queues/summary`, `GET /v1/admin/flight-requests?tab=new|mine|awaiting|quoted|reserved`,
  `GET /v1/admin/flight-requests/:ref`, `POST /v1/admin/flight-requests/:ref/commands/claim` (header `If-Match: <version>`),
  `POST …/commands/request_info {message}`, `POST …/notes {body}`, `POST …/messages {body}`,
  `POST …/contact-attempts {channel:"PHONE", outcome, note}`, call via `tel:` link. Toggle on-duty with `PATCH /v1/me {onDuty}`.
  No quote sending, recording dialogs or compliance decisions on mobile (v1).

## Screens
Customer tabs: **Search** (form: trip type, from/to autocomplete EN/FA, date with Jalali display option,
travellers, cabin, connection preferences, gateway toggle) → **Results** (progress line "Searching N sources · x of y",
tabs, cards with truth badges: LIVE/CACHED/PRICE CONFIRMED/FAKE, SEPARATE TICKETS, STARTS AT GATEWAY, price,
times, layover) → **Itinerary detail** (segments, connections with self-transfer advice, baggage "Not provided —
our team will confirm", price freshness, "Request this itinerary" + "Requesting does not book a seat") →
**Request form** (travellers, acknowledgements) → **Confirmation** (reference). **Requests** (list + detail:
status timeline in customer labels, messages, quote cards with Accept, tickets). **Cargo** (lanes list + simple
request form for DOCUMENTS/PARCEL). **Inbox**. **Account** (profile, language EN/FA → RTL, calendar, travellers,
sign out). Admin tabs: **Queue**, **Mine**, **Inbox**, **Account** (on-duty toggle).
Persistent cache: last requests list/detail JSON in shared_preferences; show "last updated" when offline.
Deep links: `/requests/:ref` route (go_router) for SMS short links.

## Done means
`flutter analyze` clean; `flutter test` for the auth/permission-refresh logic and Jalali formatting;
`flutter build web --release` succeeds; a Playwright or `flutter drive` smoke run against the web build proves:
sign in with a +98 number in Persian (RTL), search THR→LON shows results, submit a manual request, and a customer
promoted to admin (owner uses `PUT /v1/dev/users/:id/roles` with host `dev.localhost:4200`) sees admin mode after
the next call. Write `apps/mobile/README.md` (run/test) and keep screenshots under `apps/mobile/test-artifacts/`.

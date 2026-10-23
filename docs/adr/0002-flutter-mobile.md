# ADR-0002 · Flutter for the mobile app (replaces the Expo proposal)

Status: accepted

Booklet ch. 29.3 proposes Expo. The kit prescribes Flutter, and the owner asked for mobile to be tested through the
Flutter web build. Consequences, mapped onto the booklet's mobile requirements:

| Booklet requirement | Flutter implementation |
|---|---|
| Expo Router, customer tabs + admin tabs chosen from `GET /v1/me` | go_router with two `StatefulShellRoute`s; redirect chooses by permissions |
| SecureStore refresh token, access token in memory | `flutter_secure_storage` (Keychain/Keystore; IndexedDB+WebCrypto on web) |
| TanStack Query persisted cache | Riverpod providers + `shared_preferences` snapshot of request list/detail |
| Polling with back-off for search | Same (1.5 s, back-off) |
| Expo push / Pushy for Android in Iran | `devices` API accepts `EXPO`, `PUSHY`; provider adapters on the server; client registration is behind a feature flag because FCM/APNs credentials are a Stage 0 deliverable |
| `I18nManager.allowRTL` | `Directionality` from locale; Material localisations for `fa` |
| Jalali dates on Hermes | `shamsi_date` package |
| Maestro e2e | Flutter integration tests runnable on web (`flutter drive`), plus Playwright over the web build |

Shared contracts are TypeScript; the Dart models mirror `packages/contracts` and are checked by a contract test that
parses recorded API responses.

# ADR-0010 · Email-only sign-in and local test-code helper

Status: accepted (owner instruction, 25 Oct 2026).

## Email-only sign-in

Context: the booklet signs customers in with a phone OTP (email optional, `AUTH.emailSignIn`) and staff with a phone OTP plus a second factor (ch. 16.1). It also requires a verified phone before a request is submitted (`AUTH.requireVerifiedPhoneForRequests`, ch. 11.3). On 25 Oct 2026 the owner asked for email-only sign-in on every surface.

Decision:
- Customer web, the Flutter app, the Admin Panel and the Developer Panel sign in with a one-time code sent by email. The phone entry, the phone/email toggle and the voice-call fallback are removed from the sign-in screens. Staff still need the second factor (passkey or TOTP); that part of ch. 16.1 is unchanged.
- `DEFAULT_AUTH.requireVerifiedPhoneForRequests` is now `false`. Configuration is data: a database seeded before this change keeps `true` until authorised staff change AUTH in the Developer Panel.
- A request still needs a phone contact identity (ch. 11.3: the team calls the customer). The phone stays a contact detail added on the account page; it is no longer a sign-in method.
- The API still accepts `channel: "PHONE"` on `/v1/auth/otp/request`, because the phone-verification purpose and the API-level test suites use it. Refusing phone sign-in at the API (for example an `AUTH.phoneSignIn` flag) is open follow-up work; until then this decision is enforced in the UIs only.
- Seeded demo staff already have `@unitravel.example` emails (local only). The seeded Iranian demo customer has no email and cannot sign in through the UIs.

## Local test-code helper

Context: test sessions had to read the code from `/v1/dev-sink/sms` (now email) by hand, and staff had to run an authenticator app.

Decision:
- `EmailSender` also writes each message to the Valkey list `dev:email` when `APP_ENV=local`. `GET /v1/dev-sink/email` (public) reads it, like the SMS and push sinks.
- `GET /v1/auth/dev-sink/totp` (authenticated) returns the current code of the signed-in user's newest TOTP factor (a pending enrolment included). If that code was already used, it returns the next step's code.
- Both endpoints answer 404 unless `APP_ENV=local`. The sign-in screens show a small "Test sign-in (local only)" box (`packages/ui/src/product/dev-code.tsx`, and `_DevCodeBox` in Flutter) that polls them and fills the code. Outside local the first poll gets a 404 and the box never renders. No accounts are pre-created.

# ADR-0012 · Staging test sign-in (email only, no code)

Status: accepted; kept on staging until real email exists (owner, 27 Oct 2026); removal tracked in ADR-0014.

## Context

During the testing phase the owner wants testers on the VPS to sign in to every surface (customer web, the Flutter app, the Admin Panel, the Developer Panel) with an email address alone. Ch. 25.1 requires an OTP for sign-in and ch. 16.1 a second factor for staff. The local helper of ADR-0010 only works with `APP_ENV=local`, because it reads codes from the dev sinks.

The owner was shown the risk and chose "any email on staging" and "skip the staff second factor": anyone who can reach a host with this switched on can sign in as any account, staff included.

## Decision

- An environment switch `TEST_SIGN_IN` (`off` by default, or `on`). It is infrastructure, not business configuration, so it is an environment variable and cannot be turned on from the Developer Panel.
- The API **refuses to start** when `TEST_SIGN_IN=on` and `APP_ENV=production`.
- `GET /v1/auth/test-sign-in` (public) returns `{ enabled }`. `POST /v1/auth/test-sign-in` with `{ email, client, deviceId }` signs in without a code. It returns 404 when the switch is off, and it is rate-limited per IP.
- It reuses the OTP sign-in rules (ch. 11.2, 25.2). A new email creates a customer account on WEB and MOBILE. The console never creates accounts and refuses non-staff. Inactive users are refused.
- The session is created with the second factor already satisfied (`mfaLevel 1`), so staff skip TOTP. `GET /v1/auth/dev-sink/totp` also answers when the switch is on, so step-up prompts can be filled in.
- Every use is audited as `user.test_signed_in`.
- The sign-in screens show a labelled "Test sign-in (testing phase)" box only when the API reports `enabled`. Its email field fills in automatically: the browser or OS autofill, the last email used, and suggestions of the seeded demo accounts.

## Consequences

- A host with the switch on has no real authentication. Use it only for test data, never for real customer data.
- Removal: delete the endpoint, the boxes and this switch, or keep `TEST_SIGN_IN=off` (the default). The production refusal stays as a safety net either way.

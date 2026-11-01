# ADR-0019 · Bonline telephony integration (call log, click-to-call)

Status: accepted as a port plus manual log; the vendor API is UNKNOWN. Source: owner brief of 31 Oct 2026 (plan J5): "Bonline = call tracking".

## Context

Support wants every phone call recorded next to the customer and the ticket. Bonline is the telephony provider. Its API documentation has not been supplied, so no endpoint, field name or signature scheme can be stated as fact (CLAUDE.md rule 7).

## Decision

- **`TelephonyPort`** (`apps/api/src/modules/support/telephony.port.ts`) with two methods: `verifyWebhook(rawBody, headers)` and `clickToCall(...)`. The only adapter is `BonlineAdapter`, which today returns `NOT_CONFIGURED` for click-to-call and verifies webhooks with a documented, generic HMAC-SHA256 scheme (`x-bonline-signature: sha256=<hex of HMAC(rawBody)>`, secret from the vendor credential). **That scheme is INFERRED, not Bonline's documented one.** Replace it when the docs arrive; nothing else changes.
- **Credentials**: vendor `telephony:bonline` in `vendor-schemas.ts` (`webhookSecret` required; `apiKey` and `baseUrl` optional), write-only through the Developer Panel (`PUT /v1/dev/vendors/telephony:bonline/credentials`). No environment variables.
- **Manual call log works without Bonline**: `POST /v1/admin/calls` (permission `call.log`) records direction, numbers, duration, outcome, and links to a ticket or customer. A webhook-ingested call lands in the same table with `source = BONLINE` and the provider reference as an idempotency key.
- **Webhook**: `POST /v1/webhooks/bonline` is public but signed; unsigned, wrongly signed or unconfigured requests get 400 `SIGNATURE_INVALID` (one answer for all three) and are not stored. The body is stored as parsed fields only (mapping below), never the raw payload.
- **Click-to-call** (`POST /v1/admin/calls/click-to-call`) answers 501 `NOT_CONFIGURED` (new error code) until the vendor API is implemented.

## Consequences

- Call recordings and transcripts are out of scope. Retention for call logs follows the DPIA (UNKNOWN until counsel decides).
- The generic webhook field mapping (`from`, `to`, `direction`, `durationSeconds`, `status`, `callId`) is INFERRED and must be checked against Bonline's documentation.

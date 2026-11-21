# ADR-0045 · Agent QR sign-in and parcel scanning

Status: accepted (owner brief of 19 Nov 2026: "add agent login section with qr code; the agent scans the qr code and logs in and can change the status like DPD or DHL"). Builds on ADR-0043 (agents) and ADR-0042 (labels, tracking). Stage record: `docs/stages/STAGE-33.md`.

## Context

Agents (drivers, couriers, collection/delivery agents) work from a phone. Signing in to the console needs an email/phone code and, for staff, a second factor (ch. 25.2), which is slow for field staff. Courier apps (DPD, DHL) let the driver scan a parcel and update it on the spot.

## Decision

1. **Sign-in QR code.** On the agent's profile (`/cargo/agents/[id]`), staff with `cargo_agent.manage` create a sign-in QR code (`POST /v1/admin/cargo/agents/:id/sign-in-code`). The code is 32 random bytes, stored only as a SHA-256 hash in `agent_sign_in_codes`, valid **10 minutes**, **single use**; creating a new code voids the agent's earlier unused codes. The QR holds `https://<admin host>/agent-sign-in#<code>` (the code is in the fragment, so it never reaches server or proxy logs). Issuing is audited (`cargo_agent.sign_in_code_issued`).
2. **Redeeming.** The agent scans the QR with the phone camera; `/agent-sign-in` posts the code to `POST /v1/auth/agent-code` (public, rate-limited per IP). The code is consumed atomically. It signs in only when: the agent is active, the user is active, and the user holds **no role other than `agent`** (and `customer`). Anyone with any other staff role must use the normal sign-in with their second factor, so a QR can never open an admin or owner account. The resulting console session counts as second-factor satisfied: the code was issued in person by a staff member who passed their own second factor, and it is single use and short lived. The device is remembered as for any console sign-in (ADR-0022). Audited as `user.signed_in_agent_code` with the issuing staff member.
3. **Parcel scanning.** The Agent Dashboard has **Scan parcel** (`/agent/scan`). It reads the label's QR code (tracking URL) or Code 128 barcode (tracking number) with the browser's built-in `BarcodeDetector`, or takes the tracking number typed in. `GET /v1/agent/jobs/by-tracking/:trackingNumber` returns only the agent's own open jobs (OFFERED/ASSIGNED) for that shipment, 404 otherwise; one job opens directly, several (for example collection and delivery) are offered as a choice. Status changes then go through the existing agent actions and the cargo state machine (ADR-0042 D8, ADR-0043 D5): nothing new may change state.
4. **Phones without `BarcodeDetector` (iPhone Safari).** Amended 19 Nov 2026 (owner tested on Safari): the scanner falls back to **jsQR 1.4.0** (Apache-2.0, no dependencies, pinned, loaded only on the scan page) reading the label's QR code from camera frames; Code 128 needs the native detector. Approved addition to ADR-0001's stack by the owner, who installed it. Also kept as a further fallback: The agent can also scan the label with the phone's camera app; the label QR opens the public tracking page, which shows a small "Agent? Update this parcel" link to `/agent/scan?tn=<number>` on the admin host. The console only opens a job for a signed-in agent who holds an open job for that shipment.
5. **Camera permission.** The console's `Permissions-Policy` allows `camera=(self)` (it was `camera=()`); microphone, geolocation and payment stay off.

## Consequences

- Migration `0036_agent_sign_in_codes.sql`; no new permissions.
- The QR is a bearer credential for 10 minutes: show it only to the agent in person; it is not emailed or sent by SMS.

# Runbook: SMS route failure

Booklet ch. 30.7. Trigger: delivery rate below 80% for a route over 30 minutes.

## Impact
OTP sign-in and critical notifications (quote sent, action needed, ticketing deadlines) may not arrive. For Iranian customers SMS is the primary fallback when push fails (ch. 1.4, 8). OTP SLO: handed to provider within 3 s, 99% (ch. 30.5).

## Mechanics (apps/api/src/modules/notifications/)
- `notifications.service.ts#routeSms`: picks the longest matching enabled prefix row in `sms_routes` (seed: `+98` -> kavenegar, smsir; `default` -> sinch, infobip) and tries its providers in order; a failure falls through to the next. All failing raises `All providers failed for <prefix>`.
- Per-route counters (`sms:route:<prefix>:<provider>:<hour>`, 26 h expiry) feed `successRate` and `sent24h`. These count provider hand-off success or failure. Carrier delivery reports arrive at `POST /v1/webhooks/sms/:provider` and update the delivery row (`deliveryReport`). Compare both: a route can accept messages and still not deliver.
- Guard rails: `+98` can never be routed through international providers (rejected by `PUT /v1/dev/sms-routes`; ch. 8.1). Per-user throttle and daily SMS cap apply (notification matrix).
- Vendor credentials are write-only: `PUT /v1/dev/vendors/{vendor}/credentials` (vendors: sms:kavenegar, sms:smsir, sms:sinch, sms:infobip, push:expo, push:pushy, email:brevo).
- The `notification.route_degraded` event has a router handler that alerts DEVELOPERS; confirm in the Developer Panel whether your build emits it, otherwise rely on the dashboard below.

## First 15 minutes
1. `GET /v1/dev/sms-routes`: `successRate`, `sent24h`, provider order, `enabled` per prefix. `GET /v1/dev/health` shows `sms <prefix> -> <provider>` rows (not ok when failures reach 20%).
2. Identify the failing prefix and provider. Is it one provider within the route, or the whole route?
3. Use `POST /v1/dev/notification-templates/test-send` to a number you control on that route.
4. Look in the dead letters (`GET /v1/dev/queues/dead-letters`) for failed SMS jobs.

## Diagnosis
- One provider failing, next provider healthy: failover is already working; check delay and cost.
- Whole `+98` route failing: provider outage, credentials, template approval (Iranian providers require approved templates; approval time is UNKNOWN, ch. 34.3), sender line, or national connectivity (see iran-reachability-loss).
- International route: provider account balance, destination country blocked by vendor policy, sender ID rules.
- Delivery reports absent: webhook not reachable or format changed (`normaliseReports` in `channels.ts`).

## Mitigation
- Reorder or replace providers: `PUT /v1/dev/sms-routes` `{prefix, providers, enabled}` (audited). Do not add international vendors to `+98`.
- Rotate credentials if auth errors.
- For OTP, customers can use the email channel where enabled (`emailSignIn` in AUTH config) while SMS is down; consider tightening nothing further, resend cooldowns already back off.
- Critical notices also land in the in-app inbox (always written first, ch. 17.3) and push where it works.

## Recovery
Re-enable the route, send a test, confirm `successRate` climbs above 80% for 30 minutes and delivery reports return. Retry or discard failed jobs via `POST /v1/dev/jobs/{queue}/{id}/retry|discard`; do not mass-retry OTP messages (codes expire after `otpTtlSeconds`).

## Comms
Admins: tell on-duty staff to phone customers for time-critical items (quote expiries, ticketing deadlines). Customers: no public statement unless sign-in is blocked for hours. Vendor: ticket with message IDs.

## Follow-up
Record minutes below 80%; review provider order; vendor contract status is UNKNOWN (docs/stages/STAGE-0.md); consider adding a second Iranian-route provider only after counsel approval (ch. 4 question on Iranian SMS providers).

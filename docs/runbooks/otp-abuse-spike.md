# Runbook: OTP abuse spike

Booklet ch. 30.7 and ch. 25.1. Trigger: OTP sends per country greater than 3 times baseline, or OTP conversion collapses (many sends, few verifies). Typical cause: SMS pumping.

## Impact
Direct SMS cost, route reputation damage, possible provider suspension, legitimate users locked out by shared limits.

## Controls already in code (apps/api/src/modules/identity/otp.service.ts, pow.service.ts)
- Country allowlist: `AUTH.allowedCountries` (phone numbers outside it get `DESTINATION_NOT_ALLOWED`); blocked number types rejected.
- Blocked prefixes: Redis key `otp:blocked_prefix:<first 6 chars of number>` refuses a number range.
- Proof-of-work challenge (ALTCHA-compatible, self-hosted, works in Iran): after `AUTH.challengeAfterRequestsPerIp10Min` (default 3) sends from one IP in 10 minutes the API returns `CHALLENGE_REQUIRED` with a challenge; each solution is single-use, 5 min lifetime.
- Sliding limits: per number per hour and day (`maxPerHour` 5, `maxPerDay` 10 by default), exponential resend cooldown from `resendCooldownSeconds` (60 s), per IP 20/h, per /prefix network 60/h, per device 10/h, per country 2000/h; verify attempts per challenge (`otpMaxAttempts` 5) then lock; verify per IP per 10 minutes.
- Defaults live in `packages/contracts/src/defaults.ts` (`DEFAULT_AUTH`); live values are versioned config domain `AUTH`.

## First 15 minutes
1. Identify the pattern: country, prefix, IP range, device IDs. Source: audit log, `otp_challenges` rows (read-only DB role), vendor dashboards, `GET /v1/dev/sms-routes` `sent24h` jump.
2. Check conversion: sends versus successful verifies per country. Collapse confirms abuse.
3. Check cost exposure on the vendor side.

## Mitigation (least to most disruptive)
1. Publish a stricter `AUTH` config version: lower `challengeAfterRequestsPerIp10Min` (0 disables the challenge, so do not set 0), lower `maxPerHour`, remove the abused country from `allowedCountries`. `POST /v1/dev/config/AUTH/versions` then `.../versions/{version}/publish`; simulate first with `/v1/dev/config/AUTH/simulate`. Roll back by publishing the previous version.
2. Block the number range via `otp:blocked_prefix:<prefix>` (operational Redis action by a developer; record it in the incident log because it is not audited by the app).
3. Disable the abused route in `PUT /v1/dev/sms-routes` (`enabled:false`) only as a last resort: it affects real users on that prefix. Never reroute `+98` via international vendors.
4. Suspend abusing accounts: `POST /v1/dev/users/{id}/suspend`, revoke sessions `/sessions/revoke`.

## Recovery
Sends per country return to baseline, conversion recovers, vendor spend stabilises. Restore limits gradually through new config versions; keep the challenge threshold.

## Comms
Owners: cost impact. Vendor: ask for refund or fraud review if pumping reached them. Customers: only if a country was removed from `allowedCountries`; state support alternatives.

## Follow-up
Baselines per country are not defined in the booklet: set and record them (PROPOSED). Consider alerting on sends-per-country (ch. 28.5 security events). Add the pattern to the OTP tests.

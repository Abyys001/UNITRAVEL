# Runbook: Iranian reachability loss

Booklet ch. 30.7, 30.1, 1.4, 28.1 ("Availability"). Trigger: external probes from Iran fail. Check CDN, IP reputation, and whether a national shutdown is in progress.

## Impact
Customers in Iran cannot use the web app, the API or push; SMS may still work through Iranian routes. Requests in flight continue to be handled by staff. The booklet records that some hosts block Iranian visitors (ch. 1.1; Vercel 403s and Cloudflare Turnstile reachability are UNKNOWN, ch. 34.4), and that OVHcloud sanctions terms are UNKNOWN.

## What the build does by design
- No Google dependencies on user-facing paths (no Google Fonts, Maps, reCAPTCHA); proof-of-work challenge instead of a third-party CAPTCHA; fonts self-hosted (ch. 28.4).
- Push: FCM is not relied on; Iranian delivery of any push service is UNKNOWN (ch. 34.4). SMS and in-app polling are the fallbacks; the inbox is always written first.
- Customer-facing status uses honest wording; nothing is shown as booked before it is.

## First 15 minutes
1. Confirm with probes from more than one Iranian network and vantage point (the probe tooling and vendor are not specified in the booklet: UNKNOWN). Compare with probes from outside Iran to rule out our own outage (`GET /v1/dev/health`, the public API `/health` and `/ready` endpoints).
2. Determine layer: DNS, TCP/TLS, HTTP 403 (reputation or geo-block), or total national shutdown (check public connectivity trackers).
3. Check Caddy logs (`infra/caddy/Caddyfile`: JSON logs to stdout) for Iranian client IPs to see whether traffic is arriving at all.

## Diagnosis
| Result | Meaning |
|---|---|
| Fails for Iran only, other regions fine | Geo-block at CDN or host, IP reputation, or national filtering |
| 403 with a vendor page | Vendor policy or WAF rule: check CDN/host dashboard |
| TLS handshake failures | Interference or certificate issue: verify chain, HTTP/3 versus TCP fallback |
| Nothing reaches Iran at all | National shutdown: nothing to fix on our side |

## Mitigation
- Not a shutdown: remove or relax the blocking rule; request a new IP from the host if reputation is the issue; ensure HTTP/3 (UDP 443) and TCP both serve (compose exposes both).
- Shutdown: switch priority to SMS. Confirm `+98` route health (`GET /v1/dev/sms-routes`); keep the route on Iranian providers only. Note that SMS may be impaired by the same event.
- Staff: use the phone and alternative contacts stored on requests (ch. 13). Extend quote validity where customers cannot respond: send a revised quote (a price or validity change needs a new quote version, ch. 13.6).
- Do not route around legal restrictions or add services whose terms exclude Iran without counsel approval.

## Recovery
Probes from Iran succeed on two vantage points for 30 minutes; clear the backlog of customer messages; review expired quotes and reopen where appropriate (`reopen` from EXPIRED).

## Comms
Admins and owners immediately. Customers: SMS to those with open requests, wording from the template catalogue; avoid claims about cause. Counsel if a hosting provider cites sanctions.

## Follow-up
Record start/end and layer; resolve the UNKNOWN items (probe tooling, CDN choice, host terms) in docs/stages/STAGE-0.md; consider a secondary ingress only after counsel and vendor-terms review.
